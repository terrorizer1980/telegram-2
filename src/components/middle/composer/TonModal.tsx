import { ChangeEvent } from 'react';

import { GlobalActions } from '../../../global/types';
import React, {
  FC, memo, useCallback, useEffect, useState,
} from '../../../lib/teact/teact';
import { withGlobal } from '../../../lib/teact/teactn';

import { TON_INSTALL_WALLET_URL } from '../../../config';
import { pick } from '../../../util/iteratees';
import captureEscKeyListener from '../../../util/captureEscKeyListener';
import captureKeyboardListeners from '../../../util/captureKeyboardListeners';

import Button from '../../ui/Button';
import Modal from '../../ui/Modal';
import InputText from '../../ui/InputText';
import Spinner from '../../ui/Spinner';
import PrivateChatInfo from '../../common/PrivateChatInfo';

import './TonModal.scss';

export interface OwnProps {
  isOpen: boolean;
  chatId: number;
  onClear: () => void;
}

interface StateProps {
  receiverAddress?: string;
}

type DispatchProps = Pick<GlobalActions, 'requestTonAddress' | 'showNotification'>;

const DEFAULT_AMOUNT = 10;
const NANOTONS_IN_TON = 1e9;

const TonModal: FC<OwnProps & StateProps & DispatchProps> = ({
  isOpen,
  chatId,
  onClear,
  receiverAddress,
  requestTonAddress,
  showNotification,
}) => {
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [error, setError] = useState<string | undefined>();

  const {
    isWalletInstalled, canInstallWallet, walletBalance, sendTons,
  } = useTonWallet();

  const handleAmountChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setError(undefined);
    setAmount(Number(e.currentTarget.value));
  }, []);

  const canSend = receiverAddress && walletBalance && amount > 0 && walletBalance >= amount;

  const send = useCallback(() => {
    setError(undefined);

    if (!canSend) {
      return;
    }

    // TODO Request throwing exceptions
    const result = sendTons(receiverAddress!, amount);
    if (result instanceof Promise) {
      result
        .then(() => {
          showNotification({ message: 'TON coins successfully sent' });
        })
        .catch((err) => {
          setError(err.message);
        });
    } else if (result instanceof Error) {
      setError(result.message);
    } else {
      setError('Unknown Error');
    }
  }, [amount, canSend, receiverAddress, sendTons, showNotification]);

  useEffect(() => (isOpen ? captureEscKeyListener(onClear) : undefined), [isOpen, onClear]);
  useEffect(() => (isOpen ? captureKeyboardListeners({ onEnter: send }) : undefined), [isOpen, send]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!receiverAddress) {
      requestTonAddress();
    }
  }, [isOpen, receiverAddress, requestTonAddress]);

  function renderHeader() {
    return (
      <div className="modal-header-condensed">
        <Button
          round
          color="translucent"
          size="smaller"
          ariaLabel="Send TON Coins"
          onClick={onClear}
        >
          <i className="icon-close" />
        </Button>
        <div className="modal-title">Send TON Coins</div>
        <Button
          color="primary"
          size="smaller"
          className="modal-action-button"
          disabled={!canSend}
          onClick={send}
        >
          Send
        </Button>
      </div>
    );
  }

  function renderContent() {
    if (!isWalletInstalled && !canInstallWallet) {
      return (
        <div className="note big">
          Sending TON coins is only supported in Chrome
          <br /> at this moment.
        </div>
      );
    }

    return (
      <>
        {receiverAddress ? (
          <div className="address">
            <PrivateChatInfo userId={chatId} avatarSize="jumbo" noStatusOrTyping />
          </div>
        ) : (
          <div className="note big">
            <Spinner />
            Awaiting user to share his TON address...
          </div>
        )}
        <div className="send-form">
          {isWalletInstalled ? (
            <>
              <InputText
                label="Amount"
                value={String(amount)}
                inputMode="numeric"
                error={error}
                onChange={handleAmountChange}
              />
              <div className="note left">
                Available balance: {walletBalance} TON
              </div>
            </>
          ) : (
            <>
              <Button
                href={TON_INSTALL_WALLET_URL}
                color="primary"
              >
                Create TON Wallet
              </Button>
              <div className="note">
                You will need to refresh the page
                <br /> once extension is installed.
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClear} header={renderHeader()} className="TonModal">
      {renderContent()}
    </Modal>
  );
};

function useTonWallet() {
  const { ton, chrome } = window as any;
  const [walletAddress, setWalletAddress] = useState<string | undefined>();
  const [walletBalance, setWalletBalance] = useState<number | undefined>();

  // TODO Bring back when plugin is stable
  // const isWalletInstalled = ton && ton.isTonWallet;
  const isWalletInstalled = Boolean(ton);

  useEffect(() => {
    if (!isWalletInstalled) {
      return;
    }

    // TODO Replace with real balance request
    ton.send('ton_requestAccounts').then((accounts: string[]) => {
      setWalletAddress(accounts[0]);
    });
    ton.send('ton_getBalance').then((balance: number) => {
      setWalletBalance(balance / NANOTONS_IN_TON);
    });
  }, [isWalletInstalled, ton]);

  const sendTons = useCallback((to: string, amount: number) => {
    // TODO Make sure `walletAddress` exists
    return ton.send('ton_sendTransaction', [{
      from: walletAddress,
      value: String(amount * NANOTONS_IN_TON),
      to,
      data: 'Sent from Telegram WebZ',
    }]);
  }, [ton, walletAddress]);

  return {
    canInstallWallet: Boolean(chrome.runtime),
    isWalletInstalled,
    walletBalance,
    sendTons,
  };
}

export default memo(withGlobal<OwnProps>(
  (global, { chatId }): StateProps => {
    return {
      receiverAddress: (global.ton.byChatId[chatId] || {}).address,
    };
  },
  (setGlobal, actions): DispatchProps => pick(actions, [
    'requestTonAddress',
    'showNotification',
  ]),
)(TonModal));
