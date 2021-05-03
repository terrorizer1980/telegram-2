import React, { FC } from '../../../lib/teact/teact';
import { OwnProps } from './TonModal';
import { Bundles } from '../../../util/moduleLoader';

import useModuleLoader from '../../../hooks/useModuleLoader';

const TonModalAsync: FC<OwnProps> = (props) => {
  const { isOpen } = props;
  const TonModal = useModuleLoader(Bundles.Extra, 'TonModal', !isOpen);

  // eslint-disable-next-line react/jsx-props-no-spreading
  return TonModal ? <TonModal {...props} /> : undefined;
};

export default TonModalAsync;
