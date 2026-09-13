import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type {
  DesktopAiCreditHistory,
  DesktopAiCreditHistoryCursor,
  DesktopAiCreditUsage,
  DesktopAiReservation,
  DesktopCloudCacheStats,
  DesktopGiftedCreditRecord,
  DesktopInvitationOverview,
  DesktopInvitedUser,
  DesktopPaginatedResult
} from '../../../shared/types/auth'
import {
  authClient,
  cancelDesktopAiReservation,
  getDesktopAiCreditHistory,
  getDesktopAiCreditUsage,
  getDesktopAiReservations,
  getDesktopAuthApiUrl,
  getDesktopGiftedCreditRecords,
  getDesktopInvitationOverview,
  getDesktopInvitedUsers
} from '../../lib/auth-client'

class AccountService extends IpcService {
  static readonly groupName = 'account'

  /** Return audited credit receipts for the authenticated account only. */
  @IpcMethod()
  async getAiCreditHistory(
    _context: IpcContext,
    cursor?: DesktopAiCreditHistoryCursor
  ): Promise<DesktopAiCreditHistory> {
    return getDesktopAiCreditHistory(cursor)
  }

  /** Read account-scoped cache statistics from durable Cloud operation records. */
  @IpcMethod()
  async getCacheStats(_context: IpcContext): Promise<DesktopCloudCacheStats> {
    const response = await fetch(`${getDesktopAuthApiUrl()}/api/ai/cache/stats`, {
      headers: { Cookie: authClient.getCookie() }
    })
    if (!response.ok) {
      throw new Error('Cache statistics are unavailable.')
    }
    return response.json() as Promise<DesktopCloudCacheStats>
  }

  /** Return the authenticated user's server-owned AI credit balance. */
  @IpcMethod()
  async getAiCredits(_context: IpcContext): Promise<DesktopAiCreditUsage> {
    return getDesktopAiCreditUsage()
  }

  /** Return task holds for the currently authenticated Cloud account. */
  @IpcMethod()
  async getAiReservations(_context: IpcContext): Promise<DesktopAiReservation[]> {
    return getDesktopAiReservations()
  }

  /** Cancel through the authenticated server so releasing credits also revokes the task. */
  @IpcMethod()
  async cancelAiReservation(_context: IpcContext, requestId: string): Promise<void> {
    return cancelDesktopAiReservation(requestId)
  }

  /** Return invitation code, share link, and aggregate reward statistics. */
  @IpcMethod()
  async getInvitationOverview(_context: IpcContext): Promise<DesktopInvitationOverview> {
    return getDesktopInvitationOverview()
  }

  /** Return a page of users invited by this account without their email addresses. */
  @IpcMethod()
  async getInvitedUsers(
    _context: IpcContext,
    cursor?: string
  ): Promise<DesktopPaginatedResult<DesktopInvitedUser>> {
    return getDesktopInvitedUsers(cursor)
  }

  /** Return a page of welcome and invitation grant ledger entries. */
  @IpcMethod()
  async getGiftedCreditRecords(
    _context: IpcContext,
    cursor?: string
  ): Promise<DesktopPaginatedResult<DesktopGiftedCreditRecord>> {
    return getDesktopGiftedCreditRecords(cursor)
  }
}

export { AccountService }
