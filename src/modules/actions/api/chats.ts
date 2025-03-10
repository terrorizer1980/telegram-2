import {
  addReducer, getDispatch, getGlobal, setGlobal,
} from '../../../lib/teact/teactn';

import {
  ApiChat, ApiUser, ApiChatFolder, MAIN_THREAD_ID,
} from '../../../api/types';
import { NewChatMembersProgress, ChatCreationProgress, ManagementProgress } from '../../../types';
import { GlobalActions } from '../../../global/types';

import {
  ARCHIVED_FOLDER_ID,
  TOP_CHAT_MESSAGES_PRELOAD_LIMIT,
  CHAT_LIST_LOAD_SLICE,
  RE_TME_INVITE_LINK,
  RE_TME_LINK,
  TIPS_USERNAME,
  LOCALIZED_TIPS, RE_TG_LINK, RE_TME_ADDSTICKERS_LINK,
} from '../../../config';
import { callApi } from '../../../api/gramjs';
import {
  addChats,
  addUsers,
  replaceThreadParam,
  updateChatListIds,
  updateChats,
  updateChat,
  updateChatListSecondaryInfo,
  updateManagementProgress,
} from '../../reducers';
import {
  selectChat,
  selectUser,
  selectChatListType,
  selectIsChatPinned,
  selectChatFolder,
  selectSupportChat,
  selectChatByUsername,
  selectThreadTopMessageId,
  selectCurrentMessageList,
  selectThreadInfo, selectCurrentChat,
} from '../../selectors';
import { buildCollectionByKey } from '../../../util/iteratees';
import { debounce, pause, throttle } from '../../../util/schedulers';
import {
  isChatSummaryOnly, isChatArchived, prepareChatList, isChatBasicGroup,
} from '../../helpers';
import { processDeepLink } from '../../../util/deeplink';

const TOP_CHAT_MESSAGES_PRELOAD_INTERVAL = 100;
const CHATS_PRELOAD_INTERVAL = 300;
// We expect this ID does not exist
const TMP_CHAT_ID = -1;

const runThrottledForLoadChats = throttle((cb) => cb(), CHATS_PRELOAD_INTERVAL, true);
const runThrottledForLoadTopChats = throttle((cb) => cb(), 3000, true);
const runDebouncedForLoadFullChat = debounce((cb) => cb(), 500, false, true);

addReducer('preloadTopChatMessages', (global, actions) => {
  (async () => {
    const preloadedChatIds: number[] = [];

    for (let i = 0; i < TOP_CHAT_MESSAGES_PRELOAD_LIMIT; i++) {
      await pause(TOP_CHAT_MESSAGES_PRELOAD_INTERVAL);

      const {
        byId,
        listIds: { active: listIds },
        orderedPinnedIds: { active: orderedPinnedIds },
      } = getGlobal().chats;
      if (!listIds) {
        return;
      }

      const { chatId: currentChatId } = selectCurrentMessageList(global) || {};
      const { pinnedChats, otherChats } = prepareChatList(byId, listIds, orderedPinnedIds);
      const topChats = [...pinnedChats, ...otherChats];
      const chatToPreload = topChats.find(({ id }) => id !== currentChatId && !preloadedChatIds.includes(id));
      if (!chatToPreload) {
        return;
      }

      preloadedChatIds.push(chatToPreload.id);

      actions.loadViewportMessages({ chatId: chatToPreload.id, threadId: MAIN_THREAD_ID });
    }
  })();
});

addReducer('openChat', (global, actions, payload) => {
  const { id, threadId } = payload!;
  const { currentUserId } = global;
  const chat = selectChat(global, id);

  if (chat?.hasUnreadMark) {
    actions.toggleChatUnread({ id });
  }

  // Please telegram send us some updates about linked chat 🙏
  if (chat && chat.lastMessage && chat.lastMessage.threadInfo) {
    actions.requestThreadInfoUpdate({
      chatId: chat.lastMessage.threadInfo.chatId,
      threadId: chat.lastMessage.threadInfo.threadId,
    });
  }

  if (!chat) {
    if (id === currentUserId) {
      void callApi('fetchChat', { type: 'self' });
    } else {
      const user = selectUser(global, id);
      if (user) {
        void callApi('fetchChat', { type: 'user', user });
      }
    }
  } else if (isChatSummaryOnly(chat) && !chat.isMin) {
    actions.requestChatUpdate({ chatId: id });
  }

  if (threadId !== MAIN_THREAD_ID) {
    const topMessageId = selectThreadTopMessageId(global, id, threadId);
    if (!topMessageId) {
      actions.requestThreadInfoUpdate({ chatId: id, threadId });
    }
  }
});

addReducer('openLinkedChat', (global, actions, payload) => {
  const { id } = payload!;
  const chat = selectChat(global, id);
  if (!chat) {
    return;
  }

  (async () => {
    const chatFullInfo = await callApi('fetchFullChat', chat);

    if (chatFullInfo?.fullInfo?.linkedChatId) {
      actions.openChat({ id: chatFullInfo.fullInfo.linkedChatId });
    }
  })();
});

addReducer('focusMessageInComments', (global, actions, payload) => {
  const { chatId, threadId, messageId } = payload!;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  (async () => {
    const result = await callApi('requestThreadInfoUpdate', { chat, threadId });
    if (!result) {
      return;
    }

    actions.focusMessage({ chatId, threadId, messageId });
  })();
});

addReducer('openSupportChat', (global, actions) => {
  const chat = selectSupportChat(global);

  actions.openChat({ id: chat ? chat.id : TMP_CHAT_ID });

  if (chat) {
    return;
  }

  (async () => {
    const result = await callApi('fetchChat', { type: 'support' });
    if (result) {
      actions.openChat({ id: result.chatId });
    }
  })();
});

addReducer('openTipsChat', (global, actions, payload) => {
  const { langCode } = payload;

  const usernamePostfix = langCode === 'pt-br'
    ? 'BR'
    : LOCALIZED_TIPS.includes(langCode) ? (langCode as string).toUpperCase() : '';

  actions.openChatByUsername({ username: `${TIPS_USERNAME}${usernamePostfix}` });
});

addReducer('loadMoreChats', (global, actions, payload) => {
  const { listType = 'active' } = payload!;
  const listIds = global.chats.listIds[listType as ('active' | 'archived')];
  const isFullyLoaded = global.chats.isFullyLoaded[listType as ('active' | 'archived')];

  if (isFullyLoaded) {
    return;
  }

  const oldestChat = listIds
    ? listIds
      .map((id) => global.chats.byId[id])
      .filter((chat) => Boolean(chat?.lastMessage) && !selectIsChatPinned(global, chat.id))
      .sort((chat1, chat2) => (chat1.lastMessage!.date - chat2.lastMessage!.date))[0]
    : undefined;

  if (oldestChat) {
    runThrottledForLoadChats(() => loadChats(listType, oldestChat.id, oldestChat.lastMessage!.date));
  } else {
    runThrottledForLoadChats(() => loadChats(listType));
  }
});

addReducer('preloadArchivedChats', () => {
  (async () => {
    while (!getGlobal().chats.isFullyLoaded.archived) {
      const currentGlobal = getGlobal();
      const listIds = currentGlobal.chats.listIds.archived;
      const oldestChat = listIds
        ? listIds
          .map((id) => currentGlobal.chats.byId[id])
          .filter((chat) => Boolean(chat?.lastMessage) && !selectIsChatPinned(currentGlobal, chat.id))
          .sort((chat1, chat2) => (chat1.lastMessage!.date - chat2.lastMessage!.date))[0]
        : undefined;

      await loadChats('archived', oldestChat?.id, oldestChat?.lastMessage!.date);
      await pause(CHATS_PRELOAD_INTERVAL);
    }
  })();
});

addReducer('loadFullChat', (global, actions, payload) => {
  const { chatId, force } = payload!;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  if (force) {
    loadFullChat(chat);
  } else {
    runDebouncedForLoadFullChat(() => loadFullChat(chat));
  }
});

addReducer('loadTopChats', () => {
  runThrottledForLoadTopChats(() => loadChats('active'));
});

addReducer('requestChatUpdate', (global, actions, payload) => {
  const { serverTimeOffset } = global;
  const { chatId } = payload!;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  void callApi('requestChatUpdate', {
    chat,
    serverTimeOffset,
  });
});

addReducer('updateChatMutedState', (global, actions, payload) => {
  const { serverTimeOffset } = global;
  const { chatId, isMuted } = payload!;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  setGlobal(updateChat(global, chatId, { isMuted }));
  void callApi('updateChatMutedState', { chat, isMuted, serverTimeOffset });
});

addReducer('createChannel', (global, actions, payload) => {
  const {
    title, about, photo, memberIds,
  } = payload!;

  const members = (memberIds as number[])
    .map((id: number) => selectUser(global, id))
    .filter<ApiUser>(Boolean as any);

  void createChannel(title, members, about, photo);
});

addReducer('joinChannel', (global, actions, payload) => {
  const { chatId } = payload!;
  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  const { id: channelId, accessHash } = chat;

  if (channelId && accessHash) {
    void callApi('joinChannel', { channelId, accessHash });
  }
});

addReducer('deleteChatUser', (global, actions, payload) => {
  (async () => {
    const { chatId, userId }: { chatId: number; userId: number } = payload!;
    const chat = selectChat(global, chatId);
    const user = selectUser(global, userId);
    if (!chat || !user) {
      return;
    }
    await callApi('deleteChatUser', { chat, user });

    const activeChat = selectCurrentMessageList(global);
    if (activeChat && activeChat.chatId === chatId && global.currentUserId === userId) {
      actions.openChat({ id: undefined });
    }
  })();
});

addReducer('deleteChat', (global, actions, payload) => {
  (async () => {
    const { chatId }: { chatId: number } = payload!;
    const chat = selectChat(global, chatId);
    if (!chat) {
      return;
    }
    await callApi('deleteChat', { chatId: chat.id });

    const activeChat = selectCurrentMessageList(global);
    if (activeChat && activeChat.chatId === chatId) {
      actions.openChat({ id: undefined });
    }
  })();
});

addReducer('leaveChannel', (global, actions, payload) => {
  (async () => {
    const { chatId } = payload!;
    const chat = selectChat(global, chatId);
    if (!chat) {
      return;
    }

    const { id: channelId, accessHash } = chat;

    if (channelId && accessHash) {
      await callApi('leaveChannel', { channelId, accessHash });
    }

    const activeChannel = selectCurrentMessageList(global);
    if (activeChannel && activeChannel.chatId === chatId) {
      actions.openChat({ id: undefined });
    }
  })();
});

addReducer('deleteChannel', (global, actions, payload) => {
  (async () => {
    const { chatId } = payload!;
    const chat = selectChat(global, chatId);
    if (!chat) {
      return;
    }

    const { id: channelId, accessHash } = chat;

    if (channelId && accessHash) {
      await callApi('deleteChannel', { channelId, accessHash });
    }

    const activeChannel = selectCurrentMessageList(global);
    if (activeChannel && activeChannel.chatId === chatId) {
      actions.openChat({ id: undefined });
    }
  })();
});

addReducer('createGroupChat', (global, actions, payload) => {
  const { title, memberIds, photo } = payload!;
  const members = (memberIds as number[])
    .map((id: number) => selectUser(global, id))
    .filter<ApiUser>(Boolean as any);

  void createGroupChat(title, members, photo);
});

addReducer('toggleChatPinned', (global, actions, payload) => {
  const { id, folderId } = payload!;
  const chat = selectChat(global, id);
  if (!chat) {
    return;
  }

  if (folderId) {
    const folder = selectChatFolder(global, folderId);
    if (folder) {
      const shouldBePinned = !selectIsChatPinned(global, id, folderId);

      const { pinnedChatIds, includedChatIds } = folder;
      const newPinnedIds = shouldBePinned
        ? [id, ...(pinnedChatIds || [])]
        : (pinnedChatIds || []).filter((pinnedId) => pinnedId !== id);

      // With both Pin and Unpin we need to re-add a user to the included group
      const newIncludedChatIds = [id, ...includedChatIds];

      void callApi('editChatFolder', {
        id: folderId,
        folderUpdate: {
          ...folder,
          pinnedChatIds: newPinnedIds,
          includedChatIds: newIncludedChatIds,
        },
      });
    }
  } else {
    const listType = selectChatListType(global, id);
    const isPinned = selectIsChatPinned(global, id, listType === 'archived' ? ARCHIVED_FOLDER_ID : undefined);
    void callApi('toggleChatPinned', { chat, shouldBePinned: !isPinned });
  }
});

addReducer('toggleChatArchived', (global, actions, payload) => {
  const { id } = payload!;
  const chat = selectChat(global, id);
  if (chat) {
    void callApi('toggleChatArchived', {
      chat,
      folderId: isChatArchived(chat) ? 0 : ARCHIVED_FOLDER_ID,
    });
  }
});

addReducer('loadChatFolders', () => {
  void loadChatFolders();
});

addReducer('loadRecommendedChatFolders', () => {
  void loadRecommendedChatFolders();
});

addReducer('editChatFolders', (global, actions, payload) => {
  const { chatId, idsToRemove, idsToAdd } = payload!;

  (idsToRemove as number[]).forEach(async (id) => {
    const folder = selectChatFolder(global, id);
    if (folder) {
      await callApi('editChatFolder', {
        id,
        folderUpdate: {
          ...folder,
          pinnedChatIds: folder.pinnedChatIds?.filter((pinnedId) => pinnedId !== chatId),
          includedChatIds: folder.includedChatIds.filter((includedId) => includedId !== chatId),
        },
      });
    }
  });

  (idsToAdd as number[]).forEach(async (id) => {
    const folder = selectChatFolder(global, id);
    if (folder) {
      await callApi('editChatFolder', {
        id,
        folderUpdate: {
          ...folder,
          includedChatIds: folder.includedChatIds.concat(chatId),
        },
      });
    }
  });
});

addReducer('editChatFolder', (global, actions, payload) => {
  const { id, folderUpdate } = payload!;
  const folder = selectChatFolder(global, id);

  if (folder) {
    void callApi('editChatFolder', {
      id,
      folderUpdate: {
        id,
        emoticon: folder.emoticon,
        pinnedChatIds: folder.pinnedChatIds,
        ...folderUpdate,
      },
    });
  }
});

addReducer('addChatFolder', (global, actions, payload) => {
  const { folder } = payload!;
  const { orderedIds } = global.chatFolders;
  const maxId = orderedIds?.length ? Math.max.apply(Math.max, orderedIds) : ARCHIVED_FOLDER_ID;

  void createChatFolder(folder, maxId);
});

addReducer('deleteChatFolder', (global, actions, payload) => {
  const { id } = payload!;
  const folder = selectChatFolder(global, id);

  if (folder) {
    void deleteChatFolder(id);
  }
});

addReducer('toggleChatUnread', (global, actions, payload) => {
  const { id } = payload!;
  const { serverTimeOffset } = global;
  const chat = selectChat(global, id);
  if (chat) {
    if (chat.unreadCount) {
      void callApi('markMessageListRead', { serverTimeOffset, chat, threadId: MAIN_THREAD_ID });
    } else {
      void callApi('toggleDialogUnread', {
        chat,
        hasUnreadMark: !chat.hasUnreadMark,
      });
    }
  }
});

addReducer('openChatByInvite', (global, actions, payload) => {
  const { hash } = payload!;

  (async () => {
    const result = await callApi('openChatByInvite', hash);
    if (!result) {
      return;
    }

    actions.openChat({ id: result.chatId });
  })();
});

addReducer('openTelegramLink', (global, actions, payload) => {
  const { url } = payload!;
  const stickersMatch = RE_TME_ADDSTICKERS_LINK.exec(url);
  if (stickersMatch) {
    actions.openStickerSetShortName({
      stickerSetShortName: stickersMatch[1],
    });
  } else if (url.match(RE_TG_LINK)) {
    processDeepLink(url.match(RE_TG_LINK)[0]);
  } else {
    let match = RE_TME_INVITE_LINK.exec(url);

    if (match) {
      const hash = match[1];

      actions.openChatByInvite({ hash });
    } else {
      match = RE_TME_LINK.exec(url)!;

      const username = match[1];
      const chatOrChannelPostId = match[2] ? Number(match[2]) : undefined;
      const messageId = match[3] ? Number(match[3]) : undefined;
      const commentId = match[4] === 'comment' && match[5] ? Number(match[5]) : undefined;

      // Open message in private group
      if (username === 'c' && chatOrChannelPostId && messageId) {
        actions.focusMessage({
          chatId: -chatOrChannelPostId,
          messageId,
        });
      } else {
        actions.openChatByUsername({
          username,
          messageId: messageId || chatOrChannelPostId,
          commentId,
        });
      }
    }
  }
});

addReducer('acceptInviteConfirmation', (global, actions, payload) => {
  const { hash } = payload!;
  (async () => {
    const result = await callApi('importChatInvite', { hash });
    if (!result) {
      return;
    }

    actions.openChat({ id: result.id });
  })();
});

addReducer('openChatByUsername', (global, actions, payload) => {
  const { username, messageId, commentId } = payload!;

  (async () => {
    const chat = selectCurrentChat(global);

    if (!commentId) {
      if (chat && chat.username === username) {
        actions.focusMessage({ chatId: chat.id, messageId });
        return;
      }
      await openChatByUsername(actions, username, messageId);
      return;
    }

    const { chatId, type } = selectCurrentMessageList(global) || {};
    const usernameChat = selectChatByUsername(global, username);
    if (chatId && usernameChat && type === 'thread') {
      const threadInfo = selectThreadInfo(global, chatId, messageId);

      if (threadInfo && threadInfo.chatId === chatId) {
        actions.focusMessage({
          chatId: threadInfo.chatId,
          threadId: threadInfo.threadId,
          messageId: commentId,
        });
        return;
      }
    }

    if (!messageId) return;

    await openCommentsByUsername(actions, username, messageId, commentId);
  })();
});

addReducer('togglePreHistoryHidden', (global, actions, payload) => {
  const { chatId, isEnabled } = payload!;
  let chat = selectChat(global, chatId);

  if (!chat) {
    return;
  }

  (async () => {
    if (isChatBasicGroup(chat)) {
      chat = await callApi('migrateChat', chat);

      if (!chat) {
        return;
      }

      actions.openChat({ id: chat.id });
    }

    void callApi('togglePreHistoryHidden', { chat, isEnabled });
  })();
});

addReducer('updateChatDefaultBannedRights', (global, actions, payload) => {
  const { chatId, bannedRights } = payload!;
  const chat = selectChat(global, chatId);

  if (!chat) {
    return;
  }

  void callApi('updateChatDefaultBannedRights', { chat, bannedRights });
});

addReducer('updateChatMemberBannedRights', (global, actions, payload) => {
  const { chatId, userId, bannedRights } = payload!;
  let chat = selectChat(global, chatId);
  const user = selectUser(global, userId);

  if (!chat || !user) {
    return;
  }

  (async () => {
    if (isChatBasicGroup(chat)) {
      chat = await callApi('migrateChat', chat);

      if (!chat) {
        return;
      }

      actions.openChat({ id: chat.id });
    }

    await callApi('updateChatMemberBannedRights', { chat, user, bannedRights });

    const newGlobal = getGlobal();
    const chatAfterUpdate = selectChat(newGlobal, chatId);

    if (!chatAfterUpdate || !chatAfterUpdate.fullInfo) {
      return;
    }

    const { members, kickedMembers } = chatAfterUpdate.fullInfo;

    const isBanned = !!bannedRights.viewMessages;
    const isUnblocked = !Object.keys(bannedRights).length;

    setGlobal(updateChat(newGlobal, chatId, {
      fullInfo: {
        ...chatAfterUpdate.fullInfo,
        ...(members && isBanned && {
          members: members.filter((m) => m.userId !== userId),
        }),
        ...(members && !isBanned && {
          members: members.map((m) => (
            m.userId === userId
              ? { ...m, bannedRights }
              : m
          )),
        }),
        ...(isUnblocked && kickedMembers && {
          kickedMembers: kickedMembers.filter((m) => m.userId !== userId),
        }),
      },
    }));
  })();
});

addReducer('updateChatAdmin', (global, actions, payload) => {
  const {
    chatId, userId, adminRights, customTitle,
  } = payload!;
  let chat = selectChat(global, chatId);
  const user = selectUser(global, userId);

  if (!chat || !user) {
    return;
  }

  (async () => {
    if (isChatBasicGroup(chat)) {
      chat = await callApi('migrateChat', chat);

      if (!chat) {
        return;
      }

      actions.openChat({ id: chat.id });
    }

    await callApi('updateChatAdmin', {
      chat, user, adminRights, customTitle,
    });

    const newGlobal = getGlobal();
    const chatAfterUpdate = selectChat(newGlobal, chatId);

    if (!chatAfterUpdate || !chatAfterUpdate.fullInfo) {
      return;
    }

    const { adminMembers } = chatAfterUpdate.fullInfo;

    const isDismissed = !Object.keys(adminRights).length;

    setGlobal(updateChat(newGlobal, chatId, {
      fullInfo: {
        ...chatAfterUpdate.fullInfo,
        ...(adminMembers && isDismissed && {
          adminMembers: adminMembers.filter((m) => m.userId !== userId),
        }),
        ...(adminMembers && !isDismissed && {
          adminMembers: adminMembers.map((m) => (
            m.userId === userId
              ? { ...m, adminRights, customTitle }
              : m
          )),
        }),
      },
    }));
  })();
});

addReducer('updateChat', (global, actions, payload) => {
  const {
    chatId, title, about, photo,
  } = payload!;

  const chat = selectChat(global, chatId);
  if (!chat) {
    return;
  }

  (async () => {
    setGlobal(updateManagementProgress(getGlobal(), ManagementProgress.InProgress));

    await Promise.all([
      chat.title !== title
        ? callApi('updateChatTitle', chat, title)
        : undefined,
      chat.fullInfo && chat.fullInfo.about !== about
        ? callApi('updateChatAbout', chat, about)
        : undefined,
      photo
        ? callApi('editChatPhoto', { chatId, accessHash: chat.accessHash, photo })
        : undefined,
    ]);

    setGlobal(updateManagementProgress(getGlobal(), ManagementProgress.Complete));
  })();
});

addReducer('toggleSignatures', (global, actions, payload) => {
  const { chatId, isEnabled } = payload!;
  const chat = selectChat(global, chatId);

  if (!chat) {
    return;
  }

  void callApi('toggleSignatures', { chat, isEnabled });
});

addReducer('loadGroupsForDiscussion', () => {
  (async () => {
    const groups = await callApi('fetchGroupsForDiscussion');
    if (!groups) {
      return;
    }

    const addedById = groups.reduce((result, group) => {
      if (group) {
        result[group.id] = group;
      }

      return result;
    }, {} as Record<number, ApiChat>);

    const global = addChats(getGlobal(), addedById);
    setGlobal({
      ...global,
      chats: {
        ...global.chats,
        forDiscussionIds: Object.keys(addedById).map(Number),
      },
    });
  })();
});

addReducer('linkDiscussionGroup', (global, actions, payload) => {
  const { channelId, chatId } = payload!;

  const channel = selectChat(global, channelId);
  let chat = selectChat(global, chatId);
  if (!channel || !chat) {
    return;
  }

  (async () => {
    if (isChatBasicGroup(chat)) {
      chat = await callApi('migrateChat', chat);

      if (!chat) {
        return;
      }

      actions.openChat({ id: chat.id });
    }

    let { fullInfo } = chat;
    if (!fullInfo) {
      const fullChat = await callApi('fetchFullChat', chat);
      if (!fullChat) {
        return;
      }

      fullInfo = fullChat.fullInfo;
    }

    if (fullInfo.isPreHistoryHidden) {
      await callApi('togglePreHistoryHidden', { chat, isEnabled: false });
    }

    void callApi('setDiscussionGroup', { channel, chat });
  })();
});

addReducer('unlinkDiscussionGroup', (global, actions, payload) => {
  const { channelId } = payload!;

  const channel = selectChat(global, channelId);
  if (!channel) {
    return;
  }

  let chat: ApiChat | undefined;
  if (channel.fullInfo?.linkedChatId) {
    chat = selectChat(global, channel.fullInfo.linkedChatId);
  }

  (async () => {
    await callApi('setDiscussionGroup', { channel });
    if (chat) {
      loadFullChat(chat);
    }
  })();
});

addReducer('setActiveChatFolder', (global, actions, payload) => {
  return {
    ...global,
    chatFolders: {
      ...global.chatFolders,
      activeChatFolder: payload,
    },
  };
});

addReducer('loadMoreMembers', (global) => {
  (async () => {
    const { chatId } = selectCurrentMessageList(global) || {};
    const chat = chatId ? selectChat(global, chatId) : undefined;
    if (!chat || isChatBasicGroup(chat)) {
      return;
    }

    const offset = (chat.fullInfo?.members?.length) || undefined;
    const result = await callApi('fetchMembers', chat.id, chat.accessHash!, 'recent', offset);
    if (!result) {
      return;
    }

    const { members, users } = result;
    if (!members || !members.length) {
      return;
    }

    global = getGlobal();
    global = addUsers(global, buildCollectionByKey(users, 'id'));
    global = updateChat(global, chat.id, {
      fullInfo: {
        ...chat.fullInfo,
        members: [
          ...((chat.fullInfo || {}).members || []),
          ...(members || []),
        ],
      },
    });
    setGlobal(global);
  })();
});

addReducer('addChatMembers', (global, actions, payload) => {
  const { chatId, memberIds } = payload;
  const chat = selectChat(global, chatId);
  const users = (memberIds as number[]).map((userId) => selectUser(global, userId)).filter<ApiUser>(Boolean as any);

  if (!chat || !users.length) {
    return;
  }

  actions.setNewChatMembersDialogState(NewChatMembersProgress.Loading);
  (async () => {
    await callApi('addChatMembers', chat, users);
    actions.setNewChatMembersDialogState(NewChatMembersProgress.Closed);
    loadFullChat(chat);
  })();
});

addReducer('deleteChatMember', (global, actions, payload) => {
  const { chatId, userId } = payload;
  const chat = selectChat(global, chatId);
  const user = selectUser(global, userId);

  if (!chat || !user) {
    return;
  }

  (async () => {
    await callApi('deleteChatMember', chat, user);
    loadFullChat(chat);
  })();
});

async function loadChats(listType: 'active' | 'archived', offsetId?: number, offsetDate?: number) {
  const result = await callApi('fetchChats', {
    limit: CHAT_LIST_LOAD_SLICE,
    offsetDate,
    archived: listType === 'archived',
    withPinned: getGlobal().chats.orderedPinnedIds[listType] === undefined,
    serverTimeOffset: getGlobal().serverTimeOffset,
  });

  if (!result) {
    return;
  }

  const { chatIds } = result;

  if (chatIds.length > 0 && chatIds[0] === offsetId) {
    chatIds.shift();
  }

  let global = getGlobal();

  global = addUsers(global, buildCollectionByKey(result.users, 'id'));
  global = updateChats(global, buildCollectionByKey(result.chats, 'id'));
  global = updateChatListIds(global, listType, chatIds);
  global = updateChatListSecondaryInfo(global, listType, result);

  Object.keys(result.draftsById).map(Number).forEach((chatId) => {
    global = replaceThreadParam(
      global, chatId, MAIN_THREAD_ID, 'draft', result.draftsById[chatId],
    );
  });

  Object.keys(result.replyingToById).map(Number).forEach((chatId) => {
    global = replaceThreadParam(
      global, chatId, MAIN_THREAD_ID, 'replyingToId', result.replyingToById[chatId],
    );
  });

  if (chatIds.length === 0 && !global.chats.isFullyLoaded[listType]) {
    global = {
      ...global,
      chats: {
        ...global.chats,
        isFullyLoaded: {
          ...global.chats.isFullyLoaded,
          [listType]: true,
        },
      },
    };
  }

  setGlobal(global);
}

async function loadFullChat(chat: ApiChat) {
  const result = await callApi('fetchFullChat', chat);
  if (!result) {
    return;
  }

  const { users, fullInfo } = result;

  let global = getGlobal();
  if (users) {
    global = addUsers(global, buildCollectionByKey(users, 'id'));
  }
  global = updateChat(global, chat.id, { fullInfo });

  setGlobal(global);
}

async function createChannel(title: string, users: ApiUser[], about?: string, photo?: File) {
  setGlobal({
    ...getGlobal(),
    chatCreation: {
      progress: ChatCreationProgress.InProgress,
    },
  });

  const createdChannel = await callApi('createChannel', { title, about, users });
  if (!createdChannel) {
    return;
  }

  const { id: channelId, accessHash } = createdChannel;

  let global = getGlobal();
  global = updateChat(global, channelId, createdChannel);
  global = {
    ...global,
    chatCreation: {
      ...global.chatCreation,
      progress: createdChannel ? ChatCreationProgress.Complete : ChatCreationProgress.Error,
    },
  };
  setGlobal(global);
  getDispatch().openChat({ id: channelId });

  if (channelId && accessHash && photo) {
    await callApi('editChatPhoto', { chatId: channelId, accessHash, photo });
  }
}

async function createGroupChat(title: string, users: ApiUser[], photo?: File) {
  setGlobal({
    ...getGlobal(),
    chatCreation: {
      progress: ChatCreationProgress.InProgress,
    },
  });

  const createdChat = await callApi('createGroupChat', { title, users });
  if (!createdChat) {
    return;
  }

  const { id: chatId } = createdChat;

  let global = getGlobal();
  global = updateChat(global, chatId, createdChat);
  global = {
    ...global,
    chatCreation: {
      ...global.chatCreation,
      progress: createdChat ? ChatCreationProgress.Complete : ChatCreationProgress.Error,
    },
  };
  setGlobal(global);
  getDispatch().openChat({ id: chatId });

  if (chatId && photo) {
    await callApi('editChatPhoto', { chatId, photo });
  }
}

async function loadChatFolders() {
  const chatFolders = await callApi('fetchChatFolders');

  if (chatFolders) {
    const global = getGlobal();

    setGlobal({
      ...global,
      chatFolders: {
        ...global.chatFolders,
        ...chatFolders,
      },
    });
  }
}

async function loadRecommendedChatFolders() {
  const recommendedChatFolders = await callApi('fetchRecommendedChatFolders');

  if (recommendedChatFolders) {
    const global = getGlobal();

    setGlobal({
      ...global,
      chatFolders: {
        ...global.chatFolders,
        recommended: recommendedChatFolders,
      },
    });
  }
}

async function createChatFolder(folder: ApiChatFolder, maxId: number) {
  // Clear fields from recommended folders
  const { id: recommendedId, description, ...newFolder } = folder;

  await callApi('editChatFolder', {
    id: maxId + 1,
    folderUpdate: {
      id: maxId + 1,
      ...newFolder,
    },
  });

  if (!description) {
    return;
  }

  const global = getGlobal();
  const { recommended } = global.chatFolders;

  if (recommended) {
    setGlobal({
      ...global,
      chatFolders: {
        ...global.chatFolders,
        recommended: recommended.filter(({ id }) => id !== recommendedId),
      },
    });
  }
}

async function deleteChatFolder(id: number) {
  await callApi('deleteChatFolder', id);
}

async function fetchChatByUsername(
  username: string,
) {
  const global = getGlobal();
  const localChat = selectChatByUsername(global, username);
  if (localChat && !localChat.isMin) {
    return localChat;
  }

  const chat = await callApi('getChatByUsername', username);
  if (!chat) {
    return undefined;
  }

  setGlobal(updateChat(getGlobal(), chat.id, chat));

  return chat;
}

async function openChatByUsername(
  actions: GlobalActions,
  username: string,
  channelPostId?: number,
) {
  // Open temporary empty chat to make the click response feel faster
  actions.openChat({ id: TMP_CHAT_ID });

  const chat = await fetchChatByUsername(username);

  if (!chat) {
    actions.openPreviousChat();
    actions.showNotification({ message: 'User does not exist' });
    return;
  }

  if (channelPostId) {
    actions.focusMessage({ chatId: chat.id, messageId: channelPostId });
  } else {
    actions.openChat({ id: chat.id });
  }
}

async function openCommentsByUsername(
  actions: GlobalActions,
  username: string,
  messageId: number,
  commentId: number,
) {
  actions.openChat({ id: TMP_CHAT_ID });

  const chat = await fetchChatByUsername(username);

  if (!chat) return;

  const global = getGlobal();

  const threadInfo = selectThreadInfo(global, chat.id, messageId);
  let discussionChatId: number | undefined;

  if (!threadInfo) {
    const result = await callApi('requestThreadInfoUpdate', { chat, threadId: messageId });
    if (!result) return;

    discussionChatId = result.discussionChatId;
  } else {
    discussionChatId = threadInfo.chatId;
  }

  if (!discussionChatId) return;

  actions.focusMessage({
    chatId: discussionChatId,
    threadId: messageId,
    messageId: Number(commentId),
  });
}
