import mongoose from "mongoose";
import {Story} from "../schema/stories.schema";
import userSchema from "../schema/user.schema";
import { getNickNameDetails, userSocketMap } from "../../socket/initDemoSocketHandlers";
import { loggerMsg } from "../../lib/logger";
import { getIo } from "../../../infrastructure/webserver/express/v1";
import { sentPushNotificationToUser } from "./device.token.model";
import chatSchema from "../schema/chat.schema";

// userId, mediaUrl, mediaType, caption
export const createNewStoryLogic = async (
    userId: string, mediaType:string, caption:string,duration:number, files: any,
    callback: (error:any, result:any)=> void
) => {
  try {
    const io = getIo();
    const user = await userSchema.findById(userId).select("userName profilePicture");
    if (!user) {
        return callback({
          status:404,
          code:"USER_NOT_FOUND",
          message:"User not found"
        }, null)
    }

    let mediaUrls = [];
    if (files && files.length > 0) {
        mediaUrls = files.map((file:any) => `${file.key}`);
    }

    const storyData = {
        userId,
        mediaUrl: mediaUrls.length > 0 ? mediaUrls[0] : null,
        mediaType: mediaUrls.length > 0 ? files[0].mimetype : mediaType,
        caption,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Story expires in 24 hours
        viewers: [],
        duration
    };

    // Emit story upload event immediately
    const storyEventData = {
        userId,
        mediaUrl: storyData.mediaUrl,
        mediaType: storyData.mediaType,
        caption,
        expiresAt: storyData.expiresAt,
        userName: user.userName,
        visibility: user.storyPrivacy || "contacts",
        profilePicture: user.profilePicture?.replace(/^(\w+)-.*$/, `$1/${user.profilePicture}`),
    };

    const connectedUsers = Object.keys(userSocketMap);
    loggerMsg(`Connected users for story upload: ${connectedUsers}`, "debug");

    connectedUsers.forEach((connectedUserId) => {
        if (connectedUserId !== userId) {
            const socketId = userSocketMap[connectedUserId];
            if (socketId) {
                io.to(socketId).emit("storyUploaded", {
                    message: `New story uploaded by ${user.name}`,
                    data: storyEventData,
                });
                loggerMsg(`Story upload event emitted to ${connectedUserId}`, "debug");
            }
        }
    });

    // Save the story to the database asynchronously
    const newStory = new Story(storyData);
    await newStory.save();

    loggerMsg("Story saved to the database successfully.", "info");

    // Send push notifications asynchronously
    // await Promise.all(
    //     connectedUsers.map(async (connectedUserId) => {
    //         if (connectedUserId !== userId) {
    //             const notificationPayload = {
    //                 title: `New story by ${user.userName}`,
    //                 body: caption || "Check out the new story!",
    //                 click_action: CLICK_NOTIFICATION_TYPE,
    //                 type: "view_new_story",
    //                 story_id: newStory._id.toString(),
    //             };

    //             loggerMsg(`Sending push notification to ${connectedUserId}`, "debug");
    //             await sentPushNotificationToUser(connectedUserId, notificationPayload);
    //             loggerMsg(`Push notification sent to ${connectedUserId}`, "info");
    //         }
    //     })
    // );

    // return successResponse(res, "Story uploaded successfully", storyEventData);
    return callback(null,storyEventData)
  } catch (error) {
    return callback({
      status: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "An unexpected error occurred."
  },null)
  }
}


export const createNewStoryLogicNew = async (
  userId: string,
  mediaType: any,
  caption: string,
  files: any[]
): Promise<any> => {
  try {
      const user = await userSchema.findById(userId).select('_id userName profilePicture');
      if (!user) {
          throw new Error("User not found.");
      }

      let mediaUrl: string[] = [];
      if (files && files.length > 0) {
          mediaUrl = files.map((file: Express.Multer.File) => `${file.filename}`);
          mediaType = files.map((file: Express.Multer.File) => `${file.mimetype}`);
      }

      const newStory = new Story({
          userId,
          mediaUrl: mediaUrl.length > 0 ? mediaUrl[0] : null,
          mediaType: mediaType.length > 0 ? mediaType[0] : null,
          caption,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Story expires in 24 hours
          viewers: []
      });

      const newStoryCreate = await newStory.save();

      const result = {
          ...newStoryCreate.toObject(),
          userName: user?.userName,
          profilePicture: user?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${user?.profilePicture}`)
      };

      return result;
  } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Failed to create the story.");
  }
};

export const deleteStoriesLogic = async(
    storiesId: string,
    userId: string,
    callback: (error:any, result: any) => void
) => {
    try {
        const user = await userSchema.findById(userId);
        if(!user){
            return callback({
                stauts: 404,
                code: "USER_NOT_FOUND",
                message: "user not found"
            }, null)
        }

        const checkStories = await Story.findById(storiesId);
        if(!checkStories){
            return callback({
                status: 404,
                code: "STORIES_NOT_FOUND",
                message: "stories not found"
            }, null)
        }

        if(checkStories?.userId.toString() !== userId){
            return callback({
                status: 400,
                code: "UNAUTHORIZED",
                message: "You are not authorized to remove this story"
            }, null)
        }

        // delete the stories
        await Story.findByIdAndDelete(storiesId);
        return callback(null,"Storie Removed Successfully.")
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occurred."
        },null)
    }
}


export const getAllStoriesLogic = async(
userId: string,
page: number,
limit: number,
skip: number,
callback:(error:any, result:any) => void
) => {
  try {
    let stories = await Story.aggregate([
        {
            '$match': {
                'expiresAt': {
                    '$gt': new Date()
                },
            }
        },
        {
            '$lookup': {
                'from': 'users', 
                'localField': 'userId', 
                'foreignField': '_id', 
                'as': 'userDetails'
            }
        },
        {
            '$unwind': {
                'path': '$userDetails', 
                'preserveNullAndEmptyArrays': true
            }
        },
        {
            '$project': {
                '_id': 1, 
                'mediaUrl': 1,
                'mediaType': 1, 
                'caption': 1, 
                'userDetails': {
                    '_id': 1, 
                    'userName': 1, 
                    'profilePicture': 1
                }, 
                'viewers': {
                    '$size': '$viewers'
                },
                'duration':1
            }
        },
        {
            '$skip': skip
        },
        {
            '$limit': limit
        }
    ]);
    
    // Modify the profilePicture and mediaUrl in each story using map
    stories = stories.map(item => {
        return {
            ...item,
            profilePicture: item.userDetails?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${item.userDetails?.profilePicture}`),
            mediaUrl: item.mediaUrl.replace(/^(\w+)-.*$/, `$1/${item.mediaUrl}`)
        };
    });

    // Group stories by userId
    const groupedStories = stories.reduce((acc: any, story: any) => {
        const userId = story.userDetails._id.toString();
        if (!acc[userId]) {
            acc[userId] = {
                userDetails: story.userDetails,
                stories: []
            };
        }
        acc[userId].stories.push(story);
        return acc;
    }, {});

    // Get the total number of stories
    const totalStories = await Story.countDocuments({
        expiresAt: { $gt: new Date() },
    });

    return callback(null, {
        status: 1,
        message: 'All stories fetched successfully',
        data: Object.values(groupedStories),
        pagination: {
            total: totalStories,
            page,
            limit,
            totalPages: Math.ceil(totalStories / limit),
        },
    });
} catch (error) {
    return callback({
        status: 500,
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "An unexpected error occurred."
    }, null);
}
}

// old code
/*
export const getAllStoriesLogic1 = async (
  userId: string,
  page: number,
  limit: number,
  skip: number,
  callback: (error: any, result: any) => void
) => {
  try {
    let stories = await Story.aggregate([
      {
        '$match': {
          'expiresAt': { '$gt': new Date() },
          'userId': { '$ne': new mongoose.Types.ObjectId(userId) }
        }
      },
      {
        '$lookup': {
          'from': 'users',
          'localField': 'userId',
          'foreignField': '_id',
          'as': 'userDetails'
        }
      },
      {
        '$unwind': {
          'path': '$userDetails',
          'preserveNullAndEmptyArrays': true
        }
      },
      {
        '$project': {
          '_id': 1,
          'mediaUrl': 1,
          'mediaType': 1,
          'caption': 1,
          'userDetails': {
            '_id': 1,
            'name':1,
            'userName': 1,
            'profilePicture': 1,
            'lastSeen':1,
            'isOnline':1,
            'bio':1,
            'email':1,
            'phone':1,
            'countryCode':1,
            'countryISOCode':1
          },
          'viewers': { '$size': '$viewers' }
        }
      },
      { '$skip': skip },
      { '$limit': limit }
    ]);

    if(stories)
    // console.log('Fetched stories:', stories);
    loggerMsg(`Fetched stories: \n${stories.length}`, "debug");

    if (!stories || stories.length == 0) {
      loggerMsg("Debug error: No stories found", "debug");
      return callback(
        null,
        {
          status: 200,
          code: "STORIES_NOT_FOUND",
          message: "Stories not found",
          data: [],
        }
      ); // <-- Return to prevent further execution
    }

    loggerMsg(`Fetched stories Again.....: \n${stories.length}`, "debug");

    // Modify mediaUrl and userDetails.profilePicture
    stories = stories.map(item => {
      return {
        ...item,
        mediaUrl: item.mediaUrl?.replace(/^(\w+)-.*$/, `$1/${item.mediaUrl}`),
        userDetails: {
          ...item.userDetails,
          profilePicture: item.userDetails?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${item.userDetails?.profilePicture}`)
        },
      };
    });

    // Group stories by userId
    const groupedStories = stories.reduce((acc: any, story: any) => {
      const userId = story.userDetails._id.toString();
      if (!acc[userId]) {
        acc[userId] = {
          userDetails: story.userDetails,
          stories: [],
        };
      }
      acc[userId].stories.push(story);
      return acc;
    }, {});

    // Get the total number of stories
    const totalStories = await Story.countDocuments({
      expiresAt: { $gt: new Date() },
    });

    return callback(null, {
      status: 1,
      message: 'All stories fetched successfully',
      data: Object.values(groupedStories),
      pagination: {
        total: totalStories,
        page,
        limit,
        totalPages: Math.ceil(totalStories / limit),
      },
    });

  } catch (error) {
    loggerMsg(`Error fetching stories: ${error instanceof Error ? error.message : "Unknown error"}`, "error");

    return callback(
      {
        status: 500,
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "An unexpected error occurred."
      },
      null
    ); // Ensure this is only called once
  }
};
*/
// new code
export const getAllStoriesLogic1 = async (
  userId: string,
  page: number,
  limit: number,
  skip: number,
  callback: (error: any, result: any) => void
) => {
  try {
    const user = await userSchema.findById(userId).select("_id contacts nicknames");
    const contactNumbers = user?.contacts || [];

    // Function to notmalize phone numbers (remove space, take last 10 digit)
    const normalizePhoneNumber = (phone:string) => phone.replace(/\D/g,"")

    // Normalize the contacts list
    const normalizedContacts = contactNumbers.map(normalizePhoneNumber);

    // Get user Ids of contacts
    const contactUsers = await userSchema.find().select("_id phone");
    const contactUserIds = contactUsers
    .filter(user => user.phone && normalizedContacts.includes(normalizePhoneNumber(user.phone)))
    .map(user => user._id)
    
    // Get users with whom the logged-in user has an active chat
    const chatUsers = await chatSchema.find({
      participants: userId, // Find chats where the user is a participant
      isFirstMessage:1
    }).select("participants");

    // Extract user IDs from chat participants (excluding self)
    const chatUserIds = chatUsers.flatMap(chat => 
      chat.participants.filter((id: mongoose.Types.ObjectId) => id.toString() !== userId)
    );

    // combine contact users and chat users(remove duplicate)
    const allAllowedUsersIds = [...new Set([...contactUserIds, ...chatUserIds])]
    let stories = await Story.aggregate([
      {
        '$match': {
          'expiresAt': { '$gt': new Date() },
          'userId': { '$ne': new mongoose.Types.ObjectId(userId) },
          $or: [
            {'visibility': "public"}, // public stories
            {userId: {$in: allAllowedUsersIds  }, visibility: "contacts" },  // stories of contacts
            {visibility: "custom", allowedUsers:  { '$in': [new mongoose.Types.ObjectId(userId)] }} // Custom allowed users
          ]
        }
      },
      {
        '$lookup': {
          'from': 'users',
          'localField': 'userId',
          'foreignField': '_id',
          'as': 'userDetails'
        }
      },
      {
        '$unwind': {
          'path': '$userDetails',
          'preserveNullAndEmptyArrays': true
        }
      },
      {
        '$project': {
          '_id': 1,
          'mediaUrl': 1,
          'mediaType': 1,
          'caption': 1,
          'createdAt': 1,
          'userDetails': {
            '_id': 1,
            'name':1,
            'userName': 1,
            'profilePicture': 1,
            'lastSeen':1,
            'isOnline':1,
            'bio':1,
            'email':1,
            'phone':1,
            'countryCode':1,
            'countryISOCode':1
          },
          'viewers': { '$size': '$viewers' },
          'duration':1
        }
      },
      {'$sort' : {'createdAt': 1}},
      { '$skip': skip },
      { '$limit': limit }
    ]);
                
    async function fetchNickname(users:any, loggedInUserId: any){
      if(users._id.toString() === loggedInUserId) return users;

      const nicknameData = await getNickNameDetails(loggedInUserId.toHexString(), users._id.toString());
            
      const matchedNick = nicknameData?.[0]?.matchedNickname?.[0];
      return {
          ...users,
          nickName: matchedNick?.nickName,
          isActiveNickname: matchedNick?.isActiveNickname
          // name: nick ?? p.name
      }
    }

    if(stories)
    // console.log('Fetched stories:', stories);
    loggerMsg(`Fetched stories: \n${stories.length}`, "debug");

    if (!stories || stories.length == 0) {
      loggerMsg("Debug error: No stories found", "debug");
      return callback(
        null,
        {
          status: 200,
          code: "STORIES_NOT_FOUND",
          message: "Stories not found",
          data: [],
        }
      ); // <-- Return to prevent further execution
    }

    
    // Modify mediaUrl and userDetails.profilePicture
    const processedStories = await Promise.all(stories.map(item => {
      return {
        ...item,
        mediaUrl: item.mediaUrl?.replace(/^(\w+)-.*$/, `$1/${item.mediaUrl}`),
        userDetails: {
          ...item.userDetails,
          profilePicture: item.userDetails?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${item.userDetails?.profilePicture}`)
        },
      };
    }));
    
    // Group stories by userId
    const groupedStories: any = {};

    for (const story of processedStories) {
      const userDetails = await fetchNickname(story.userDetails, user?._id);
      const userId = story.userDetails._id.toString();

      if (!groupedStories[userId]) {
        groupedStories[userId] = {
          userDetails,
          stories: [],
        };
      }

      groupedStories[userId].stories.push(story);
    }

    // Get the total number of stories
    const totalStories = await Story.countDocuments({
      expiresAt: { $gt: new Date() },
    });

    return callback(null, {
      status: 1,
      message: 'All stories fetched successfully',
      data: Object.values(groupedStories),
      pagination: {
        total: totalStories,
        page,
        limit,
        totalPages: Math.ceil(totalStories / limit),
      },
    });

  } catch (error) {
    loggerMsg(`Error fetching stories: ${error instanceof Error ? error.message : "Unknown error"}`, "error");

    return callback(
      {
        status: 500,
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "An unexpected error occurred."
      },
      null
    ); // Ensure this is only called once
  }
};



export const getUserStoriesWithViewerDetailsLogic = async(
    userId: string,
    callback:(error:any,result:any) => void
)=> {
    try {
        const user = await userSchema.findById(userId);
        if(!user){
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "User not found."
            },null)
        }

        let stories = await Story.aggregate([
            {
              '$match': {
                'userId': new mongoose.Types.ObjectId(userId), 
                'expiresAt': {
                  '$gt': new Date()
                }
              }
            }, {
              '$lookup': {
                'from': 'users', 
                'localField': 'userId', 
                'foreignField': '_id', 
                'as': 'storyCreatorDetails'
              }
            }, {
              '$unwind': {
                'path': '$storyCreatorDetails', 
                'preserveNullAndEmptyArrays': true
              }
            }, {
              '$lookup': {
                'from': 'users', 
                'localField': 'viewers.userId', 
                'foreignField': '_id', 
                'as': 'viewersDetails'
              }
            }, {
              '$project': {
                'mediaUrl': 1,
                'mediaType': 1, 
                'caption': 1, 
                'createdAt': 1, 
                'expiresAt': 1, 
                'viewersDetails': 1, 
                'storyCreatorDetails': {
                  '_id': 1, 
                  'userName': 1, 
                  'profilePicture': 1
                }, 
                'viewerCount': {
                  '$size': '$viewers'
                }
              }
            }, {
              '$sort': {
                'createdAt': 1
              }
            }
          ]);

          const nicknamesMap = new Map<string, {nickName:string,isActiveNickname:boolean}>();
          user?.nicknames.forEach(n => {
              if(n.contactUserId && n.nickName){
                  nicknamesMap.set(n.contactUserId.toString(), {
                      nickName: n.nickName,
                      isActiveNickname: n.isActiveNickname ?? false
                  })
              }
          })

          function fetchNickname(users:any, loggedInUserId: any){
            if(users._id.toString() === loggedInUserId) return users;
            
            const nick = nicknamesMap.get(users?._id.toString());
            
            return {
                ...users,
                nickName: nick?.nickName,
                isActiveNickname: nick?.isActiveNickname,
                // name: nick ?? chat.name
            }
          }

          if(stories && stories.length > 0){
            stories = stories.map(item => {
              return {
                ...item,
                viewersProfilePicture: item.viewersDetails?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${item.viewersDetails?.profilePicture}`),
                storyCreatorProfilePicture: item.storyCreatorDetails?.profilePicture?.replace(/^(\w+)-.*$/, `$1/${item.storyCreatorDetails?.profilePicture}`),
                mediaUrl: item.mediaUrl.replace(/^(\w+)-.*$/, `$1/${item.mediaUrl}`)
              }
            })
            return callback(null,{
                status: 1,
                code: "FETCH_ALL_STORIES_LOGGED_IN_USER",
                message: "all stories fetchd of logged-in user.",
                data: stories
            })
        }else{
            return callback(null,{
                status: 0,
                code: "STORIES_NOT_FOUND",
                message: "stories are not found.",
                data: []
            })
        }
    } catch (error) {
        return callback(null,{
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occrred."
        })
    }
}


export const getUserStoriesWithViewerDetailsLogic1 = async(
  userId: string,
  page:number,
  limit:number,
  callback:(error:any,result:any) => void
)=> {
  try {
    // Pagination calculation
      const skip = (page - 1) * limit;

      // Find the stories of the user
      const stories = await Story.find({
        userId: new mongoose.Types.ObjectId(userId),
        expiresAt: {$gt: new Date()}
      })
      .sort({createdAt: 1})
      .skip(skip)
      .limit(limit)
      .lean();

      // Fetch creator details for each story
      const creatorIds = stories.map(story => story.userId)

      const storyCreators = await userSchema.find({_id: {$in: creatorIds} })
      .select('_id userName name profilePicture').lean();

      // Map creator details to their corresponding stories
      const creatorsMap = storyCreators.reduce((acc, creator) => {
        acc[creator._id.toString()] = {
          ...creator,
          profilePicture: creator.profilePicture?.replace(/^(\w+)-.*$/, `$1/${creator.profilePicture}`), // Modify profilePicture
        };
        return acc;
      }, {} as Record<string, any>);
      
      // Fetch Viewer details for all viewers in the stories
      const viewerIds: Array<string | mongoose.Types.ObjectId | null> = stories.flatMap(story =>
        (story.viewers || []).map((viewer: any) => viewer.userId)
      );
      // const uniqueViewerIds = [...new Set(viewerIds.map(id => id.toString()))];
      const uniqueViewerIds = [...new Set(viewerIds.filter(id => id != null).map(id => id!.toString()))];

      const viewerDetails = await userSchema.find({ _id: { $in: uniqueViewerIds } })
      .select('_id name userName profilePicture lastSeen bio email isOnline countryCode countryISOCode')
      .lean();

      const viewersMap = viewerDetails.reduce((acc, viewer) => {
        acc[viewer._id.toString()] = {
          ...viewer,
          profilePicture: viewer.profilePicture?.replace(/^(\w+)-.*$/, `$1/${viewer.profilePicture}`), // Modify profilePicture
        };
        return acc;
      }, {} as Record<string, any>);

      const user = await userSchema.findById(userId).select("nicknames");
      const nicknamesMap = new Map<string, {nickName:string,isActiveNickname:boolean}>();
          user?.nicknames.forEach(n => {
              if(n.contactUserId && n.nickName){
                  nicknamesMap.set(n.contactUserId.toString(), {
                      nickName: n.nickName,
                      isActiveNickname: n.isActiveNickname ?? false
                  })
              }
          })

          async function fetchNickname(users:any, loggedInUserId: any){
            if(users.userId.toString() === loggedInUserId) return users;

            const nicknameData = await getNickNameDetails(loggedInUserId.toString(),users.userId.toString());
            
            const matchedNick = nicknameData?.[0]?.matchedNickname?.[0];
            return {
                ...users,
                nickName: matchedNick?.nickName,
                isActiveNickname: matchedNick?.isActiveNickname
                // name: nick ?? p.name
            }
          }

      if(stories && stories.length > 0){
    // Attach creator and viewer details to stories
    const enhancedStories = await Promise.all(stories.map(async (story) => {
      return {
        ...story,
        mediaUrl: story.mediaUrl?.replace(/^(\w+)-.*$/, `$1/${story.mediaUrl}`),
        storyCreatorDetails: creatorsMap[story.userId.toString()] || null,
        viewersDetails: await Promise.all((story.viewers || []).map(async (viewer: any) => {
          const storyViewerDetails = await fetchNickname(viewer, userId);
          
          return {
          ...viewer,
          ...viewersMap[viewer.userId.toString()],
          ...storyViewerDetails
        }})),
        viewerCount: (story.viewers || []).length,
      };
    }));

    // Total count of stories for pagination
    const totalStories = await Story.countDocuments({
      userId: new mongoose.Types.ObjectId(userId),
      expiresAt: { $gt: new Date() },
    });

    return callback(null, {
      status: 1,
      message: 'Stories fetched successfully',
      data: enhancedStories,
      pagination: {
        total: totalStories,
        page,
        limit,
        totalPages: Math.ceil(totalStories / limit),
      },
    });
  }else{
    return callback(null,{
      status:1,
      code:"STORIES_NOT_FOUND",
      message:"Stories not found",
      data:[]
    })
  }
  } catch (error) {
      return callback(null,{
          status: 500,
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "An unexpected error occrred."
      })
  }
}


export const viewStoryLogic = async (
    viewUserId: string,
    storiesId: string,
    callback:(error:any, result: any) => void
) => {
    try {
        const user = await userSchema.findById(viewUserId);
        if(!user){
            return callback({
                status: 404,
                code: "USER_NOT_FOUND",
                message: "user not found"
            },null)
        }

        const story = await Story.findById(storiesId);
        if(!story){
            return callback({
                status: 404,
                code: "STORY_NOT_FOUND",
                message: "story not found"
            },null)
        }

        // check if the user has already viewed the story
        const alreadyViewd = story.viewers.some(viewer => viewer.userId.toString() === viewUserId);

        if(!alreadyViewd){
            // Add the viewer if not already present
            story.viewers.push({userId: new mongoose.Types.ObjectId(viewUserId), viewedAt: new Date()})
            await story.save();
        }

        return callback(null,"Story viewed successfully")
    } catch (error) {
        return callback({
            status: 500,
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "An unexpected error occrred."
        },null)
    }
}