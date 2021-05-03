import { addReducer, getGlobal, setGlobal } from '../../../lib/teact/teactn';

import { TON_MSG_ADDRESS_REQUEST, TON_MSG_ADDRESS_RESPONSE } from '../../../config';
import { selectCurrentMessageList } from '../../selectors';

addReducer('requestTonAddress', (global, actions) => {
  actions.sendMessage({ text: TON_MSG_ADDRESS_REQUEST });
});

addReducer('shareTonAddress', (global, actions, payload) => {
  const { ton } = window as any;
  if (!ton) {
    return;
  }

  const { requesterId, requestedAt } = payload;

  const { lastAddressShareAt } = global.ton.byChatId[requesterId] || {};
  if (lastAddressShareAt && lastAddressShareAt >= requestedAt) {
    return;
  }

  (async () => {
    const addresses = await ton.send('ton_requestAccounts');

    global = getGlobal();

    const { chatId } = selectCurrentMessageList(global) || {};
    if (chatId !== requesterId) {
      return;
    }

    actions.sendMessage({
      text: `${TON_MSG_ADDRESS_RESPONSE}${addresses[0]}`,
    });

    global = {
      ...global,
      ton: {
        ...global.ton,
        byChatId: {
          ...global.ton.byChatId,
          [requesterId]: {
            ...global.ton.byChatId[requesterId],
            lastAddressShareAt: Date.now(),
          },
        },
      },
    };

    setGlobal(global);
  })();
});

addReducer('saveTonAddress', (global, actions, payload) => {
  const { chatId, address } = payload;

  const { address: currentAddress } = global.ton.byChatId[chatId] || {};

  if (currentAddress === address) {
    return undefined;
  }

  return {
    ...global,
    ton: {
      ...global.ton,
      byChatId: {
        ...global.ton.byChatId,
        [chatId]: {
          ...global.ton.byChatId[chatId],
          address,
        },
      },
    },
  };
});
