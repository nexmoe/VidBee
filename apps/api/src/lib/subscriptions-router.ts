/**
 * oRPC router that mounts `subscriptionContract` on the API server.
 *
 * Each route is a 1:1 forward into the singleton `SubscriptionsApi`. The
 * server.ts wiring exposes this router under `/rpc/subscriptions/*`.
 */
import { implement, ORPCError } from '@orpc/server'
import { SUBSCRIPTION_DUPLICATE_FEED_ERROR, subscriptionContract } from '@vidbee/subscriptions-core'

import { getApiSubscriptions, removeApiSubscription } from './subscriptions-host'

const os = implement(subscriptionContract)

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return fallback
}

const isDuplicateFeedError = (error: unknown): boolean =>
  error instanceof Error && error.message === SUBSCRIPTION_DUPLICATE_FEED_ERROR

export const subscriptionsRouter = os.router({
  list: os.list.handler(async () => {
    return getApiSubscriptions().list()
  }),

  get: os.get.handler(async ({ input }) => {
    try {
      return await getApiSubscriptions().get(input)
    } catch (error) {
      throw new ORPCError('NOT_FOUND', {
        message: toErrorMessage(error, 'Subscription not found.')
      })
    }
  }),

  resolve: os.resolve.handler(async ({ input }) => {
    return getApiSubscriptions().resolve(input)
  }),

  add: os.add.handler(async ({ input }) => {
    try {
      return await getApiSubscriptions().add(input)
    } catch (error) {
      if (isDuplicateFeedError(error)) {
        throw new ORPCError('CONFLICT', {
          message: SUBSCRIPTION_DUPLICATE_FEED_ERROR
        })
      }
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: toErrorMessage(error, 'Failed to create subscription.')
      })
    }
  }),

  update: os.update.handler(async ({ input }) => {
    try {
      return await getApiSubscriptions().update(input)
    } catch (error) {
      if (isDuplicateFeedError(error)) {
        throw new ORPCError('CONFLICT', {
          message: SUBSCRIPTION_DUPLICATE_FEED_ERROR
        })
      }
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: toErrorMessage(error, 'Failed to update subscription.')
      })
    }
  }),

  remove: os.remove.handler(async ({ input }) => {
    await removeApiSubscription(input.id)
    return {}
  }),

  refresh: os.refresh.handler(async ({ input }) => {
    try {
      return await getApiSubscriptions().refresh(input)
    } catch (error) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: toErrorMessage(error, 'Failed to refresh subscription.')
      })
    }
  }),

  itemsList: os.itemsList.handler(async ({ input }) => {
    try {
      return await getApiSubscriptions().itemsList(input)
    } catch (error) {
      throw new ORPCError('NOT_FOUND', {
        message: toErrorMessage(error, 'Subscription not found.')
      })
    }
  }),

  itemsQueue: os.itemsQueue.handler(async ({ input }) => {
    try {
      return await getApiSubscriptions().itemsQueue(input)
    } catch (error) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: toErrorMessage(error, 'Failed to queue subscription item.')
      })
    }
  })
})

export type SubscriptionsRouter = typeof subscriptionsRouter
