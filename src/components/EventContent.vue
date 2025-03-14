<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  nip19,
  parseReferences,
  SimplePool,
  nip10,
  finalizeEvent,
  verifyEvent,
  type Event,
} from 'nostr-tools';
import type { EventExtended } from './../types';
import { loadAndInjectDataToPosts, getEventWithAuthorById } from '../utils/utils';
import RawData from './RawData.vue';
import EventActionsBar from './EventActionsBar.vue';
import EventText from './EventText/EventText.vue';
import Textarea from '@/components/Textarea.vue';
import { useNpub } from '@/stores/Npub';
import { useNsec } from '@/stores/Nsec';
import { useUser } from '@/stores/User';
import { useImages } from '@/stores/Images';
import { useRelay } from '@/stores/Relay';
import { useMetasCache } from '@/stores/MetasCache';

import {
  parseRelaysNip65,
  publishEventToRelays,
  formatedDate,
  filterRootEventReplies,
  filterReplyEventReplies,
  getUserUrlPath,
} from '../utils/utils';
import LinkIcon from './../icons/LinkIcon.vue';
import CheckIcon from './../icons/CheckIcon.vue';
import CheckSquareIcon from './../icons/CheckSquareIcon.vue';
import ThreadIcon from './../icons/ThreadIcon.vue';
import InvalidSignatureIcon from './../icons/InvalidSignatureIcon.vue';

const emit = defineEmits([
  'toggleRawData',
  'showReplyField',
  'loadRootReplies',
  'resetSentStatus',
  'loadMoreReplies',
]);
const replyText = ref('');
const msgErr = ref('');

const props = defineProps<{
  event: EventExtended;
  pool: SimplePool;
  index?: number;
  hasReplyBtn?: boolean;
  isMainEvent?: boolean;
  currentReadRelays?: string[];
  threadDescender?: Event;
}>();

const router = useRouter();
const npubStore = useNpub();
const nsecStore = useNsec();
const userStore = useUser();
const imagesStore = useImages();
const relayStore = useRelay();
const metasCacheStore = useMetasCache();

const showReplyField = ref(false);
const isPublishingReply = ref(false);
const eventReplies = ref<EventExtended[]>([]);
const showReplies = ref(false);
const isCopiedEventLink = ref(false);
const isSigVerified = ref(false);
const isLoadingReplies = ref(false);
const ancestorsEvents = ref<Event[]>([]);
const isLoadingThread = ref(false);
const isMounted = ref(true);

const handleToggleRawData = (eventId: string) => {
  if (props.isMainEvent) {
    return emit('toggleRawData', eventId);
  }
  props.event.showRawData = !props.event.showRawData;
};

const isSearchPage = computed(() => router.currentRoute.value.name === 'Search');

onMounted(() => {
  if (Object.keys(props.event).length === 0) return;
  isSigVerified.value = verifyEvent(props.event as Event);
});

onUnmounted(() => {
  isMounted.value = false;
});

const displayName = (author: any, pubkey: string) => {
  if (author) {
    let name = '';
    if (author.name) {
      name = author.name;
    } else if (author.username) {
      name = author.username;
    } else {
      name = author.display_name;
    }
    if (name && name.length) {
      return name;
    }
  }
  return nip19.npubEncode(pubkey).slice(0, 10) + '...';
};

const handleToggleReplyField = () => {
  showReplyField.value = !showReplyField.value;
  emit('showReplyField');
};

const handleSendReply = async () => {
  if (isPublishingReply.value) return;

  if (!nsecStore.isValidNsecPresented()) {
    msgErr.value = 'Please login with your private key to send a reply.';
    return;
  }

  const messageValue = replyText.value.trim();
  if (!messageValue.length) {
    msgErr.value = 'Please provide message to broadcast.';
    return;
  }

  let privkey: Uint8Array | null;
  let pubkey: string;
  try {
    privkey = nsecStore.getPrivkeyBytes();
    if (!privkey) {
      throw new Error();
    }
    pubkey = nsecStore.getPubkey();
    if (!pubkey.length) {
      throw new Error();
    }
  } catch (e) {
    msgErr.value = `Invalid private key. Please check it and try again.`;
    return;
  }

  const writeRelays = relayStore.connectedUserWriteRelaysUrls;
  if (!writeRelays.length) {
    msgErr.value = 'Please provide your write relays to broadcast event';
    return;
  }

  const event = {
    kind: 1,
    pubkey: pubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: messageValue,
    tags: [],
    id: '',
    sig: '',
  };

  // keep all menitoned people and keep the thread chain from the event we are replying to
  const existedETags: any = [];
  const existedPTags: any = [];
  props.event.tags.forEach((tag) => {
    const tempTag = [tag[0], tag[1]];
    if (tag[2]) tempTag.push(tag[2]);
    if (tag[3]) tempTag.push(tag[3]);

    if (tempTag[0] === 'e') {
      existedETags.push(tempTag);
    } else if (tempTag[0] === 'p') {
      existedPTags.push(tempTag);
    }
  });

  // keep chain and add own e tag
  const eTagsForReply: any = [];
  if (existedETags.length) {
    const root = existedETags.find((tag: any) => tag[3] === 'root');
    if (root) {
      eTagsForReply.push(root);
    } else {
      eTagsForReply.push(existedETags[0]);
    }
    eTagsForReply.push(['e', props.event.id, '', 'reply']);
  } else {
    eTagsForReply.push(['e', props.event.id, '', 'root']);
  }

  // keep all mentioned people and add own from message if presented
  const msgReferences = parseReferences(event);
  const existedPubKeys = existedPTags.map((tag: any) => tag[1]);
  const pTagsFromOurMsg: any = [];
  msgReferences.forEach((ref) => {
    const refPubkey = ref?.profile?.pubkey;
    if (refPubkey && !existedPubKeys.includes(refPubkey)) {
      pTagsFromOurMsg.push(['p', refPubkey]);
      existedPubKeys.push(refPubkey);
    }
  });

  // add author pubkey from event we are replying to
  // https://github.com/nostr-protocol/nips/blob/master/10.md#the-p-tag
  const pTagsForReply = [...pTagsFromOurMsg, ...existedPTags];
  if (!existedPubKeys.includes(props.event.pubkey)) {
    pTagsForReply.push(['p', props.event.pubkey]);
  }

  // gather all tags together and sign message
  event.tags = [...pTagsForReply, ...eTagsForReply] as never[];
  const signedEvent = finalizeEvent(event, privkey);

  msgErr.value = '';
  isPublishingReply.value = true;

  // all mentions except author of the event
  const pubkeysMentions = pTagsForReply
    .filter((tag: any) => tag[1] !== pubkey)
    .map((tag: any) => tag[1]);
  let additionalRelays: string[] = [];

  const { pool } = props;
  if (pubkeysMentions.length) {
    const allRelays = [
      ...relayStore.readRelays,
      ...relayStore.writeRelays,
      relayStore.currentRelay.url,
    ];
    const relays = [...new Set(allRelays)]; // make array values unique
    const metaEvents = await pool.querySync(relays, { kinds: [10002], authors: pubkeysMentions });

    const mentionsReadRelays = new Set<string>();
    metaEvents.forEach((event: Event) => {
      if (event.tags.length) {
        const { read } = parseRelaysNip65(event);
        read.forEach((r: string) => {
          if (relayStore.writeRelays.includes(r)) return;
          mentionsReadRelays.add(r);
        });
      }
    });

    additionalRelays = [...mentionsReadRelays];
  }

  const result = await publishEventToRelays(writeRelays, pool, signedEvent);
  const hasSuccess = result.some((data: any) => data.success);

  if (!hasSuccess) {
    msgErr.value = 'Failed to broadcast reply';
    return;
  }

  if (additionalRelays.length) {
    try {
      await pool.publish(additionalRelays, signedEvent);
    } catch (e) {
      console.error('Failed to broadcast reply to some additional relays');
    }
  }

  isPublishingReply.value = false;
  showReplyField.value = false;
  replyText.value = '';

  if (props.isMainEvent) {
    return emit('loadRootReplies');
  }

  handleLoadReplies();
};

const handleLoadReplies = async () => {
  const { event, currentReadRelays, pool } = props;

  if (!currentReadRelays?.length || !pool) return;

  if (props.isMainEvent) {
    return emit('loadMoreReplies');
  }

  isLoadingReplies.value = true;

  // filter replies for particular event
  let replies = await pool.querySync(currentReadRelays, { kinds: [1], '#e': [event.id] });
  if (!isMounted.value) return;

  if (event.isRoot) {
    replies = filterRootEventReplies(event, replies);
  } else {
    replies = filterReplyEventReplies(event, replies);
  }

  // if we have thread and event has only one reply (descender), then it's already shown
  const descender = props.threadDescender;
  if (replies.length == 1 && descender?.id === replies[0].id) {
    isLoadingReplies.value = false;
    return;
  }

  const isRootPosts = false;
  await loadAndInjectDataToPosts(
    replies,
    event,
    {},
    currentReadRelays,
    metasCacheStore,
    pool as SimplePool,
    isRootPosts
  );
  if (!isMounted.value) return;

  eventReplies.value = replies as EventExtended[];
  showReplies.value = true;
  isLoadingReplies.value = false;
};

const handleHideReplies = () => {
  showReplies.value = false;
};

const handleCopyEventLink = () => {
  const { origin, pathname } = window.location;
  let noteId = nip19.noteEncode(props.event.id);
  const eventLink = `${origin}${pathname}#/event/${noteId}`;
  navigator.clipboard.writeText(eventLink);
  isCopiedEventLink.value = true;
  setTimeout(() => {
    isCopiedEventLink.value = false;
  }, 2000);
};

const handleUserClick = (pubkey: string) => {
  const urlNpub = nip19.npubEncode(pubkey);
  npubStore.updateNpubInput(urlNpub);
  userStore.updateRoutingStatus(true);
  router.push({ path: getUserUrlPath(pubkey) });
};

const getAncestorsEventsChain = async (
  event: EventExtended,
  parentEvent: Event | null = null
): Promise<EventExtended[]> => {
  const { currentReadRelays, pool } = props;
  if (!currentReadRelays?.length || !pool) return [];

  const nip10Data = nip10.parse(event);
  if (!nip10Data.root && !nip10Data.reply) return [];

  if (nip10Data.root && !nip10Data.reply) {
    let rootEvent = parentEvent;

    if (!rootEvent) {
      rootEvent = await pool.get(currentReadRelays, { kinds: [1], ids: [nip10Data.root.id] });
    }

    if (!rootEvent) return [];

    const isRootPosts = true;
    await loadAndInjectDataToPosts(
      [rootEvent],
      null,
      {},
      currentReadRelays,
      metasCacheStore,
      pool as SimplePool,
      isRootPosts
    );

    return [rootEvent] as EventExtended[];
  }

  if (nip10Data.reply) {
    if (!parentEvent) {
      parentEvent = (await pool.get(currentReadRelays, {
        kinds: [1],
        ids: [nip10Data.reply.id],
      })) as EventExtended;
    }

    if (!parentEvent) return [];

    const nip10DataParentReplyingTo = nip10.parse(parentEvent);
    const parentReplyingToId =
      nip10DataParentReplyingTo?.reply?.id || nip10DataParentReplyingTo?.root?.id;
    const parentReplyingToEvent = await getEventWithAuthorById(
      parentReplyingToId || '',
      currentReadRelays,
      pool as SimplePool
    );

    const isRootPosts = false;
    await loadAndInjectDataToPosts(
      [parentEvent],
      parentReplyingToEvent as EventExtended | null,
      {},
      currentReadRelays,
      metasCacheStore,
      pool as SimplePool,
      isRootPosts
    );

    const ancestors = await getAncestorsEventsChain(
      parentEvent as EventExtended,
      parentReplyingToEvent
    );
    return [parentEvent as EventExtended, ...ancestors];
  }

  return [];
};

const loadEventThread = async () => {
  const { event, pool, currentReadRelays } = props;
  if (!currentReadRelays?.length || !pool) return;

  if (isLoadingThread.value) return;
  isLoadingThread.value = true;

  const ancestorsChain = await getAncestorsEventsChain(
    event as EventExtended,
    event.replyingTo.event
  );
  if (!isMounted.value) return;

  const ancestors = ancestorsChain.reverse();
  isLoadingThread.value = false;
  ancestorsEvents.value = ancestors;
};

const hanleReplyInput = (value: string) => {
  replyText.value = value;
};
</script>

<template>
  <div class="thread">
    <div class="ancestor" :key="event.id" v-for="(aEvent, i) in ancestorsEvents">
      <EventContent
        @toggleRawData="() => handleToggleRawData(aEvent.id)"
        :event="aEvent as EventExtended"
        :currentReadRelays="currentReadRelays"
        :pool="pool"
        :hasReplyBtn="hasReplyBtn"
        :threadDescender="ancestorsEvents[i + 1] ? ancestorsEvents[i + 1] : event"
      />
    </div>

    <div v-if="isLoadingThread" class="loading-thread">Loading thread...</div>
  </div>

  <div class="event-card">
    <div :class="['event-card__content', { flipped: event.showRawData }]">
      <div
        :class="[
          'event-card__front',
          'event__presentable-date',
          {
            'event-card__front_custom': !isSearchPage && nsecStore.getPubkey() === event.pubkey,
          },
        ]"
      >
        <div v-if="imagesStore.showImages" class="event-img">
          <img
            v-if="event.author"
            :class="['author-pic', { 'author-pic__squared': !event.author.picture }]"
            :src="event.author.picture"
            :title="`Avatar for ${event.author.name}`"
            alt="user's avatar"
          />
          <i v-else class="bi bi-person-circle author-pic__alternate"></i>
        </div>
        <div class="event-content">
          <div class="event-header">
            <div>
              <a
                class="event-username-link"
                @click.prevent="() => handleUserClick(event.pubkey)"
                :href="getUserUrlPath(event.pubkey)"
              >
                <b class="event-username-text">{{ displayName(event.author, event.pubkey) }}</b>
              </a>
            </div>
            <div>
              {{ formatedDate(event.created_at) }}
            </div>
          </div>

          <div v-if="event.replyingTo" class="event-replying-to">
            <span
              @click="loadEventThread"
              v-if="isMainEvent"
              class="view-thread event-username-link event-username-text"
            >
              <ThreadIcon /> View thread
            </span>
            <span class="replying-to-separator" v-if="isMainEvent"> &nbsp;|&nbsp; </span>
            <span>
              Replying to
              <a
                @click.prevent="() => handleUserClick(event.replyingTo.pubkey)"
                :href="getUserUrlPath(event.replyingTo.pubkey)"
                class="event-username-link event-username-text"
                >@{{ displayName(event.replyingTo.user, event.replyingTo.pubkey) }}</a
              >
            </span>
          </div>

          <div class="event-body">
            <EventText :event="event" :slice="true" />
          </div>

          <div class="event-footer">
            <EventActionsBar
              @showReplyField="handleToggleReplyField"
              @handleShowReplies="handleLoadReplies"
              @handleHideReplies="handleHideReplies"
              :hasReplyBtn="hasReplyBtn"
              :likes="event.likes"
              :reposts="event.reposts"
              :replies="event.replies"
            />
            <div class="event-footer__right-actions">
              <div class="event-footer__link-wrapper">
                <CheckIcon
                  v-if="isCopiedEventLink"
                  class="event-footer-copy-icon event-footer-copy-icon_check"
                />
                <LinkIcon
                  v-if="!isCopiedEventLink"
                  @click="handleCopyEventLink"
                  title="Copy link"
                  class="event-footer-copy-icon"
                />
              </div>
              <span
                @click="() => handleToggleRawData(event.id)"
                title="See raw data"
                class="event-footer-code"
              >
                {...}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        :class="[
          'event-card__back',
          {
            'event-card__back_custom': !isSearchPage && nsecStore.getPubkey() === event.pubkey,
            'event-details-first': index === 0,
          },
        ]"
      >
        <div class="event__raw-data">
          <RawData :event="event" :authorEvent="event.authorEvent" />
        </div>
        <div class="event-footer-code-wrapper">
          <div
            :class="[
              'event-footer__signature',
              { 'event-footer__signature_invalid': !isSigVerified },
            ]"
          >
            <CheckSquareIcon v-if="isSigVerified" />
            <InvalidSignatureIcon v-if="!isSigVerified" />
            <span class="event-footer__signature-text">
              {{ isSigVerified ? 'Signature is valid' : 'Invalid signature' }}
            </span>
          </div>
          <div class="event-footer__right-actions">
            <div class="event-footer__link-wrapper">
              <CheckIcon
                v-if="isCopiedEventLink"
                class="event-footer-copy-icon event-footer-copy-icon_check"
              />
              <LinkIcon
                v-if="!isCopiedEventLink"
                @click="handleCopyEventLink"
                title="Copy link"
                class="event-footer-copy-icon"
              />
            </div>
            <span
              @click="() => handleToggleRawData(event.id)"
              title="See raw data"
              class="event-footer-code"
            >
              {...}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div v-if="showReplyField" class="reply-field">
    <Textarea
      placeholder="Write a reply..."
      class="reply-field__textarea"
      :rows="4"
      @input="hanleReplyInput"
    />
    <div class="reply-field__actions">
      <div class="error">{{ msgErr }}</div>
      <button :disabled="isPublishingReply" @click="handleSendReply" class="reply-field__btn">
        {{ isPublishingReply ? 'Sending reply...' : 'Reply' }}
      </button>
    </div>
  </div>

  <div v-if="isLoadingReplies" class="loading-replies">Loading replies...</div>

  <div v-if="showReplies && eventReplies.length" class="replies">
    <div class="reply" :key="reply.id" v-for="reply in eventReplies">
      <!-- <div class="reply__vertical-line"></div> -->
      <EventContent
        @toggleRawData="() => handleToggleRawData(event.id)"
        :event="reply as EventExtended"
        :currentReadRelays="currentReadRelays"
        :pool="pool"
        :hasReplyBtn="hasReplyBtn"
      />
    </div>
  </div>
</template>

<style scoped>
.replies {
  margin-bottom: 30px;
}

.reply {
  margin-top: 15px;
  position: relative;
}
.reply__vertical-line {
  position: absolute;
  background-color: #2a2f3b;
  width: 1px;
  height: 15px;
  left: 38px;
  top: -15px;
}

.loading-replies {
  display: inline-block;
  margin-top: 5px;
}

.event-body {
  min-height: 60px;
}

.event-card {
  perspective: 40rem;
}

.event-card__content {
  transform-style: preserve-3d;
  transition: transform 0.5s;
  position: relative;
}

.event-card__content.flipped {
  transform: rotateX(-180deg);
}

.event-card__front,
.event-card__back {
  backface-visibility: hidden;
  border: 1px solid #2a2f3b;
  padding: 14px;
  border-radius: 5px;
}

.event-card__front_custom,
.event-card__back_custom {
  border-color: #0092bf;
}

.event-card__back {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  transform: rotateX(-180deg);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.event__raw-data {
  margin-top: 28px;
  overflow-y: hidden;
  margin-bottom: 2px;
}

.event-card__content.flipped .event__raw-data {
  overflow-y: scroll;
}

.event__presentable-date {
  display: flex;
}

.event-img {
  margin-right: 12px;
  max-width: 50px;
}

.author-pic {
  width: 50px;
  height: 50px;
  min-width: 50px;
  min-height: 50px;
  border-radius: 50%;
}

.author-pic__squared {
  border-radius: 0;
}

.author-pic__alternate {
  display: inline-block;
  font-size: 50px;
  line-height: 1;
}

.event-username-link {
  color: #0092bf;
  text-decoration: none;
  cursor: pointer;
}

.event-content {
  flex-grow: 1;
}

.event-header {
  display: flex;
  justify-content: space-between;
  flex-direction: column;
}

@media (min-width: 768px) {
  .event-header {
    flex-direction: row;
  }
}

.view-thread {
  display: inline-flex;
  align-items: center;
  min-width: 100px;
}

.event-replying-to {
  display: flex;
  align-items: start;
  flex-direction: column;
  font-size: 15px;
  margin-top: 3px;
  margin-bottom: 3px;
}

.replying-to-separator {
  display: none;
}

@media (min-width: 412px) {
  .event-replying-to {
    flex-direction: row;
    align-items: center;
  }

  .replying-to-separator {
    display: inline;
  }
}

.event-username-text {
  word-break: break-word;
}

.event-footer {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
}

.event-footer-code {
  cursor: pointer;
}

.event-footer-code-wrapper {
  margin-top: 2px;
  display: flex;
  justify-content: space-between;
}

.event-details-first {
  margin-top: 30px;
}

.reply-field__textarea {
  margin: 10px 0;
}

.reply-field__actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.reply-field__btn {
  cursor: pointer;
  background: #0092bf;
  color: white;
  border: none;
  border-radius: 5px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.2s;
  width: auto;
}

.reply-field__btn:hover {
  background: #0077a3;
}

.reply-field__btn:active {
  opacity: 0.9;
}

.reply-field__btn.disabled {
  opacity: 0.6;
  cursor: default;
}

.reply-field__btn.disabled:hover {
  background: #0092bf;
}

.error {
  color: #ff4040;
  font-size: 16px;
  flex-grow: 1;
  text-align: right;
  margin-right: 10px;
}

.event-footer__right-actions {
  display: inline-flex;
}

.event-footer__link-wrapper {
  position: relative;
}

.event-footer-copy-icon {
  cursor: pointer;
  margin-right: 4px;
  margin-top: 4px;
}

@media (min-width: 375px) {
  .event-footer-copy-icon {
    margin-right: 10px;
  }
}

.event-footer-copy-icon_check {
  cursor: auto;
}

.event-footer__signature {
  display: flex;
  align-items: center;
}

.event-footer__signature-text {
  margin-left: 5px;
}

.event-footer__signature_invalid {
  color: red;
}

.ancestor {
  margin-bottom: 15px;
}

.loading-thread {
  margin-bottom: 5px;
}
</style>
