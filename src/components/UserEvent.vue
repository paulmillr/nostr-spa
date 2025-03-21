<script setup lang="ts">
import { ref, watchEffect, onMounted } from 'vue';
import { verifyEvent, nip19, type Event } from 'nostr-tools';
import RawData from './RawData.vue';
import type { Author, EventExtended } from './../types';
import CheckSquareIcon from './../icons/CheckSquareIcon.vue';
import InvalidSignatureIcon from './../icons/InvalidSignatureIcon.vue';
import { formatedDateYear } from '../utils/utils';

const props = defineProps<{
  event: EventExtended;
  author: Author;
}>();

const showRawData = ref(false);
const showHexId = ref(false);
const showHexPubkey = ref(false);

const id = ref('');
const sig = ref('');
const pubkey = ref('');
const created_at = ref(0);
const isSigVerified = ref(false);

watchEffect(() => {
  const { event } = props;
  id.value = event.id;
  sig.value = event.sig;
  pubkey.value = event.pubkey;
  created_at.value = event.created_at;
});

onMounted(() => {
  if (Object.keys(props.event).length === 0) {
    return;
  }
  isSigVerified.value = verifyEvent(props.event as Event);
});

const handleToggleRawData = () => {
  showRawData.value = !showRawData.value;
};
</script>

<template>
  <div class="event">
    <div v-if="!showRawData" class="event__content">
      <slot>No content for event</slot>
      <hr />

      <div class="event__code-block">
        <div class="event__code-title">
          <b>Author: </b>
          <button class="event__code-btn" @click="showHexPubkey = !showHexPubkey">
            {{ showHexPubkey ? 'npub' : 'hex' }}
          </button>
        </div>
        <div class="content-col_code">
          <code class="event__code">
            {{ showHexPubkey ? pubkey : nip19.npubEncode(pubkey) }}
          </code>
        </div>
      </div>

      <div class="event__code-block">
        <div class="event__code-title">
          <b>Meta event id: </b>
          <button class="event__code-btn" @click="showHexId = !showHexId">
            {{ showHexId ? 'nevent' : 'hex' }}
          </button>
        </div>
        <div class="content-col_code">
          <code class="event__code">
            {{ showHexId ? id : nip19.neventEncode({ id }) }}
          </code>
        </div>
      </div>

      <div>
        <div class="header-col"><b>Updated: </b></div>
        <div class="content-col_code">
          <code class="event__code">
            {{ formatedDateYear(created_at) }}
          </code>
        </div>
      </div>
    </div>

    <RawData v-if="showRawData" :isUserEvent="true" :event="event" :authorEvent="event" />

    <div class="event-footer" :class="{ 'event-footer_flex-end': !showRawData }">
      <div
        v-if="showRawData"
        :class="['event-footer__signature', { 'event-footer__signature_invalid': !isSigVerified }]"
      >
        <CheckSquareIcon v-if="isSigVerified" />
        <InvalidSignatureIcon v-if="!isSigVerified" />
        <span class="event-footer__signature-text">
          {{ isSigVerified ? 'Signature is valid' : 'Invalid signature' }}
        </span>
      </div>
      <div>
        <span class="event-footer-code" @click="handleToggleRawData">{...}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.event__code-block {
  margin-bottom: 10px;
}

.event__code-title {
  color: #999;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.event__code-btn {
  background: #2a2f3b;
  color: white;
  border: none;
  border-radius: 5px;
  padding: 3px 12px;
  cursor: pointer;
  transition: background 0.2s;
  font-size: 15px;
  font-weight: bold;
}

.event__code-btn:hover {
  background: #323741;
}

.event__code-btn:active {
  opacity: 0.9;
}

.event__code {
  font-size: 15px;
}

.header-col {
  color: #999;
}

.content-col_code {
  word-break: break-word;
}

.event {
  border: 1px solid #2a2f3b;
  padding: 14px;
  padding-top: 0;
  margin-top: 25px;
  border-radius: 5px;
}

/* common styles */

.event-footer {
  display: flex;
  justify-content: space-between;
}

.event-footer_flex-end {
  justify-content: flex-end;
}

.event-footer-code {
  cursor: pointer;
}

button {
  cursor: pointer;
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

hr {
  border: 1px solid #2a2f3b;
}
</style>
