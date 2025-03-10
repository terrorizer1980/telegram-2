import { ApiDocument } from './messages';

export interface ApiInitialArgs {
  userAgent: string;
  platform?: string;
  sessionData?: ApiSessionData;
  isMovSupported?: boolean;
}

export interface ApiOnProgress {
  (
    progress: number, // Float between 0 and 1.
    ...args: any[]
  ): void;

  isCanceled?: boolean;
  acceptsBuffer?: boolean;
}

export interface ApiAttachment {
  blobUrl: string;
  filename: string;
  mimeType: string;
  size: number;
  quick?: {
    width: number;
    height: number;
    duration?: number;
  };
  voice?: {
    duration: number;
    waveform: number[];
  };
  previewBlobUrl?: string;
}

export interface ApiWallpaper {
  slug: string;
  document: ApiDocument;
}

export interface ApiSession {
  hash: string;
  isCurrent: boolean;
  isOfficialApp: boolean;
  isPasswordPending: boolean;
  deviceModel: string;
  platform: string;
  systemVersion: string;
  appName: string;
  appVersion: string;
  dateCreated: number;
  dateActive: number;
  ip: string;
  country: string;
  region: string;
}

export interface ApiSessionData {
  mainDcId: number;
  keys: Record<number, string | number[]>;
  hashes: Record<number, string | number[]>;
}

export type ApiNotifyException = {
  chatId: number;
  isMuted: boolean;
  isSilent?: boolean;
  shouldShowPreviews?: boolean;
};

export type ApiNotification = {
  localId: string;
  message: string;
};

export type ApiError = {
  message: string;
  hasErrorKey?: boolean;
  isSlowMode?: boolean;
  textParams?: Record<string, string>;
};

export type ApiFieldError = {
  field: string;
  message: string;
};

export type ApiInviteInfo = {
  title: string;
  hash: string;
  isChannel?: boolean;
  participantsCount?: number;
};

export interface ApiCountry {
  isHidden?: boolean;
  iso2: string;
  defaultName: string;
  name?: string;
}

export interface ApiCountryCode extends ApiCountry {
  countryCode: string;
  prefixes?: string[];
  patterns?: string[];
}
