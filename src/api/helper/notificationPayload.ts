// Builds the minimal 'sender'/'groupInfo' payloads embedded in FCM push
// notifications. The client (notification_handler.dart, push_notifications.dart,
// calllit_handler.dart) only ever reads a handful of fields off these objects
// — sending the full Mongoose document risks tripping FCM's hard 4KB total
// payload limit for large groups or verbose profiles, with no benefit since
// the extra fields are never used.

export const buildSenderPayload = (sender: any) => {
    if (!sender) return sender;
    return {
        name: sender.name,
        profilePicture: sender.profilePicture,
    };
};

export const buildGroupInfoPayload = (chat: any) => {
    if (!chat) return chat;
    return {
        groupName: chat.groupName,
        groupImage: chat.groupImage,
        isSendMessage: chat.isSendMessage,
        restrictContentSharing: chat.restrictContentSharing,
        isProfilePhoto: chat.isProfilePhoto,
    };
};
