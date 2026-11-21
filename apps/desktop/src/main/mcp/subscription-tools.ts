import { SubscriptionUpdateInputSchema } from '@vidbee/subscriptions-core/schemas'
import { z } from 'zod'
import {
  listAgentSubscriptions,
  manageAgentSubscription,
  testAgentSubscription
} from '../lib/agent-management-host'
import { getDesktopSubscriptions } from '../lib/subscriptions-host'
import { defineMcpTool, mcpId, mcpLimit, mcpOffset, mcpWebUrl } from './tool'

const preferences = SubscriptionUpdateInputSchema.pick({
  downloadType: true,
  downloadQuality: true,
  downloadContainer: true
})
const subscriptionSchema = z.object({
  url: mcpWebUrl.optional(),
  title: z.string().min(1).max(200).optional(),
  downloadDirectory: z.string().min(1).max(4096).optional(),
  namingTemplate: z.string().min(1).max(300).optional(),
  enabled: z.boolean().optional(),
  autoDownload: z.boolean().optional(),
  onlyDownloadLatest: z.boolean().optional(),
  keywords: z.array(z.string().max(100)).max(30).optional(),
  tags: z.array(z.string().max(100)).max(30).optional(),
  ...preferences.shape
})

/** Apply validated subscription preferences through the shared host after feed validation. */
async function writeSubscription(
  input: z.output<typeof subscriptionSchema>,
  id: string | undefined,
  signal: AbortSignal
) {
  return await manageAgentSubscription(
    { ...input, id, action: id ? 'update' : 'add', approvedPath: true },
    signal
  )
}

/** Expose subscription discovery, validation, configuration, refresh and item admission. */
export function createMcpSubscriptionTools() {
  return [
    defineMcpTool(
      'list_subscriptions',
      'Search subscriptions by ID/title/feed URL. Results omit item bodies and include refresh errors; follow nextOffset.',
      z.object({ query: z.string().max(200).optional(), offset: mcpOffset }),
      (input) => listAgentSubscriptions(input),
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'get_subscription',
      'Read one saved subscription and its configuration.',
      z.object({ id: mcpId }),
      async ({ id }) => {
        const { items, ...subscription } = await getDesktopSubscriptions().get({ id })
        return { ...subscription, itemCount: items.length }
      },
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'test_subscription',
      'Resolve and fetch an RSS/Atom, website or supported channel URL without saving or downloading. Returns evidence and corrected feed URLs when discovered.',
      z.object({ url: mcpWebUrl }),
      ({ url }, signal) => testAgentSubscription(url, signal),
      { readOnlyHint: true, openWorldHint: true }
    ),
    defineMcpTool(
      'create_subscription',
      'Validate a feed then save a subscription. autoDownload defaults false; enable it explicitly for automatic downloads.',
      subscriptionSchema.extend({ url: mcpWebUrl }),
      (input, signal) => writeSubscription(input, undefined, signal),
      { openWorldHint: true }
    ),
    defineMcpTool(
      'update_subscription',
      'Patch a subscription; omitted preferences are retained and changed URLs are fetched before saving.',
      subscriptionSchema.extend({ id: mcpId }),
      ({ id, ...input }, signal) => writeSubscription(input, id, signal),
      { openWorldHint: true }
    ),
    defineMcpTool(
      'remove_subscription',
      'Remove a subscription and cancel its outstanding tasks. Completed media files are retained.',
      z.object({ id: mcpId }),
      ({ id }, signal) => manageAgentSubscription({ action: 'remove', id }, signal),
      { destructiveHint: true }
    ),
    defineMcpTool(
      'refresh_subscription',
      'Fetch a subscription now. May queue new items when its saved autoDownload preference is enabled.',
      z.object({ id: mcpId }),
      ({ id }, signal) => manageAgentSubscription({ action: 'refresh', id }, signal),
      { openWorldHint: true }
    ),
    defineMcpTool(
      'list_subscription_items',
      'Read paginated feed entries and download status for one subscription.',
      z.object({ subscriptionId: mcpId, offset: mcpOffset, limit: mcpLimit }),
      (input) => getDesktopSubscriptions().itemsList(input),
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'queue_subscription_item',
      'Queue one existing feed entry using the subscription download preferences. Returns its task ID.',
      z.object({ subscriptionId: mcpId, itemId: mcpId }),
      (input) => getDesktopSubscriptions().itemsQueue(input, { origin: 'agent' })
    )
  ]
}
