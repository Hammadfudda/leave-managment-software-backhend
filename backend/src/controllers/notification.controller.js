import Notification from '../models/Notification.js';

import {
  asyncHandler,
} from '../utils/asyncHandler.js';

import {
  NotFoundError,
} from '../utils/errors.js';

import {
  getPagination,
  paginated,
} from '../utils/pagination.js';

/*
|--------------------------------------------------------------------------
| LIST CURRENT USER NOTIFICATIONS
|--------------------------------------------------------------------------
|
| A user only ever sees their own notifications.
|
*/
export const listNotifications =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const filter = {
        userId:
          req.currentUser._id,
      };

      if (
        req.query.isRead !==
        undefined
      ) {
        filter.isRead =
          req.query.isRead ===
          'true';
      }

      const pagination =
        getPagination(
          req.query
        );

      const [
        items,
        total,
        unreadCount,
      ] =
        await Promise.all([
          Notification.find(
            filter
          )
            .sort({
              createdAt:
                -1,
            })
            .skip(
              pagination.skip
            )
            .limit(
              pagination.limit
            ),

          Notification.countDocuments(
            filter
          ),

          Notification.countDocuments({
            userId:
              req.currentUser._id,
            isRead:
              false,
          }),
        ]);

      res.json({
        success: true,
        unreadCount,
        ...paginated(
          items,
          total,
          pagination
        ),
      });
    }
  );

/*
|--------------------------------------------------------------------------
| MARK ONE READ
|--------------------------------------------------------------------------
*/
export const markRead =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const notification =
        await Notification.findOne({
          _id:
            req.params.id,

          userId:
            req.currentUser._id,
        });

      if (
        !notification
      ) {
        throw new NotFoundError();
      }

      if (
        !notification.isRead
      ) {
        notification.isRead =
          true;

        await notification.save();
      }

      res.json({
        success: true,
        data:
          notification,
      });
    }
  );

/*
|--------------------------------------------------------------------------
| MARK ALL CURRENT USER NOTIFICATIONS READ
|--------------------------------------------------------------------------
*/
export const markAllRead =
  asyncHandler(
    async (
      req,
      res
    ) => {
      const result =
        await Notification.updateMany(
          {
            userId:
              req.currentUser._id,

            isRead:
              false,
          },
          {
            $set: {
              isRead:
                true,
            },
          }
        );

      res.json({
        success: true,
        modifiedCount:
          result.modifiedCount ||
          0,
      });
    }
  );
