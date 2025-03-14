<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { utils, Relay, SimplePool, type Event } from 'nostr-tools';
import { DEFAULT_RELAY, DEFAULT_RELAYS } from '@/app';
import { parseRelaysNip65 } from '@/utils/utils';
import {
  connectToSelectedRelay,
  getConnectedReadWriteRelays,
  getUserRelaysList,
  getUserMeta,
} from '@/utils/network';
import Dropdown from '@/components/Dropdown.vue';
import Checkbox from '@/components/Checkbox.vue';

import { useNsec } from '@/stores/Nsec';
import { useRelay } from '@/stores/Relay';
import { useFeed } from '@/stores/Feed';
import { useOwnProfile } from '@/stores/OwnProfile';
import { useUser } from '@/stores/User';
import { usePool } from '@/stores/Pool';

const poolStore = usePool();
const pool = poolStore.pool as SimplePool;

const relayStore = useRelay();
const nsecStore = useNsec();
const feedStore = useFeed();
const ownProfileStore = useOwnProfile();
const userStore = useUser();
const router = useRouter();

const selectedRelay = ref<string>(DEFAULT_RELAY);
const showCustomRelayUrl = computed(() => selectedRelay.value === 'custom');
const showRememberMe = computed(() => nsecStore.isValidNsecPresented());
const loginError = ref('');
const connectingStatus = ref(false);

const dropdownRelays = DEFAULT_RELAYS.map((r: string) => ({ key: r, value: r })).concat({
  key: 'custom',
  value: 'Custom relay url',
});

let afterLoginPath = '/feed';
let redirectToUser = false;

onMounted(() => {
  if (isRedirectedFromSearch()) {
    afterLoginPath = history.state.back;
    redirectToUser = true;
  }
});

watch(
  () => nsecStore.nsec,
  () => {
    if (!nsecStore.isValidNsecPresented()) {
      localStorage.clear();
      nsecStore.setRememberMe(false);
      return;
    }

    if (nsecStore.rememberMe) {
      localStorage.setItem('privkey', nsecStore.nsec);
    }
  }
);

const setConnectingStatus = (status: boolean) => {
  connectingStatus.value = status;
};

const isRedirectedFromSearch = () => {
  return history.state && /^\/(user|event)\/[a-zA-Z0-9]+$/g.test(history.state.back);
};

const handleSelect = (selected: string) => {
  selectedRelay.value = selected;
};

const showError = (msg: string) => {
  loginError.value = msg;
};

const stopConnectingWithError = (msg: string) => {
  setConnectingStatus(false);
  showError(msg);
};

const handleConnectClick = async () => {
  let relayUrl = selectedRelay.value;
  if (relayUrl === 'custom') {
    const customUrl = relayStore.selectInputCustomRelayUrl;
    relayUrl = customUrl.length ? customUrl : '';
  }

  if (!relayUrl.length) {
    return showError('Please provide relay URL or choose one from the list.');
  }

  relayUrl = utils.normalizeURL(relayUrl);
  if (!relayUrl.length) {
    return showError('Invalid relay URL');
  }

  if (nsecStore.isNotValidNsecPresented()) {
    return showError('Private key is invalid. Please check it and try again.');
  }

  if (connectingStatus.value) {
    return showError('Your are already connecting to the relay. Please wait.');
  }

  await connect(relayUrl);
};

const connect = async (relayUrl: string) => {
  setConnectingStatus(true);

  let relay: Relay;
  try {
    relay = await connectToSelectedRelay(relayUrl);
  } catch (err: any) {
    return stopConnectingWithError(err.message);
  }
  relayStore.updateCurrentRelay(relay);

  if (nsecStore.isValidNsecPresented()) {
    const pubkey = nsecStore.getPubkey();
    const authorMeta = await getUserMeta(pubkey, [relayUrl], pool);

    if (!authorMeta) {
      return stopConnectingWithError(
        'Your profile was not found on the selected relay. Please check the private key or change the relay and try again.'
      );
    }

    ownProfileStore.updateMeta(authorMeta);
    feedStore.setSelectedFeedSource('follows');

    let relaysList = await getUserRelaysList(pubkey, [relayUrl], pool);
    if (relaysList?.tags.length) {
      const freshRelaysList = await getFreshRelaysList(relaysList, relayUrl);
      relayStore.setReadWriteRelays(parseRelaysNip65(freshRelaysList));
    }

    relayStore.setReadWriteRelaysStatus({ connecting: true, connected: false });
    const userReadWriteRelays = relayStore.userReadWriteRelays;
    const { read, write } = await getConnectedReadWriteRelays(pool, userReadWriteRelays);
    relayStore.setConnectedUserReadWriteRelays({ read, write });
    relayStore.setReadWriteRelaysStatus({ connecting: false, connected: true });
  }

  setConnectingStatus(false);

  if (redirectToUser) {
    userStore.updateRoutingStatus(true);
  }
  feedStore.setMountAfterLogin(true);

  router.push({ path: afterLoginPath });
};

const handleRememberMe = () => {
  nsecStore.setRememberMe(!nsecStore.rememberMe);
  nsecStore.rememberMe ? localStorage.setItem('privkey', nsecStore.nsec) : localStorage.clear();
};

const getFreshRelaysList = async (oldList: Event, alreadyUsedRelay: string) => {
  const pubkey = oldList.pubkey;
  const relays = oldList.tags
    .map((tag) => utils.normalizeURL(tag[1]))
    .filter((url) => url !== alreadyUsedRelay);
  const freshList = await getUserRelaysList(pubkey, relays, pool);
  if (freshList && freshList.tags.length && freshList.created_at >= oldList.created_at) {
    return freshList;
  }
  return oldList;
};
</script>

<template>
  <div class="fields">
    <div class="field">
      <label class="select-relay-label">
        <strong>Select relay</strong>
      </label>
      <Dropdown :listItems="dropdownRelays" @handleSelect="handleSelect" />
    </div>

    <div v-if="showCustomRelayUrl" class="field">
      <div class="field-elements">
        <input
          v-model="relayStore.selectInputCustomRelayUrl"
          class="text-input"
          id="relay_url"
          type="text"
          placeholder="[wss://]relay.example.com"
        />
      </div>
    </div>

    <div class="field">
      <label class="text-input-label" for="priv_key">
        <strong>Login with private key (optional)</strong>
      </label>
      <div class="field-elements">
        <input
          v-model="nsecStore.nsec"
          class="text-input"
          id="priv_key"
          type="password"
          placeholder="nsec..."
        />
      </div>
    </div>
    <div class="remember-me">
      <Checkbox
        v-if="showRememberMe"
        @onChange="handleRememberMe"
        :checked="nsecStore.rememberMe"
        :label="'Remember me'"
      />
    </div>

    <div class="field">
      <button :disabled="connectingStatus" @click="handleConnectClick" class="button button-block">
        {{ connectingStatus ? 'Connecting...' : 'Connect' }}
      </button>
    </div>

    <div class="error">{{ loginError }}</div>
  </div>
</template>

<style scoped>
.select-relay-label {
  display: inline-block;
  margin-bottom: 5px;
}

.fields {
  width: 100%;
  margin: 2rem auto;
}

@media (min-width: 576px) {
  .fields {
    width: 60%;
  }
}

@media (min-width: 768px) {
  .fields {
    width: 50%;
  }
}

.field {
  margin-top: 15px;
  width: 100%;
}

.field-elements {
  overflow: hidden;
}

.text-input-label {
  display: inline-block;
  margin-bottom: 7px;
}

.text-input {
  background: #100f0f !important;
  color: inherit;
  border: 1px solid #2a2f3b;
  outline: none;
  border-radius: 5px;
  padding: 6px 12px;
  width: 100%;
  box-sizing: border-box;
}

.text-input:focus {
  border: 1px solid #0092bf;
  background: #100f0f !important;
}

.button {
  background: #0092bf;
  color: white;
  border: none;
  border-radius: 5px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.2s;
  width: 100%;
}

.button:active {
  opacity: 0.9;
}

.button:hover {
  background: #0077a3;
}

.button:disabled {
  background: #0077a3;
  opacity: 1;
}

.button-block {
  display: block;
}

.error {
  color: #ff4040;
  font-size: 16px;
  margin-top: 10px;
}

.remember-me {
  margin-top: 5px;
}
</style>
