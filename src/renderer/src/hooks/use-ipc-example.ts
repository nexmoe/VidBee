import { ipcServices } from '@renderer/lib/ipc'
import { useState } from 'react'
import { toast } from 'sonner'

/**
 * Example custom hook demonstrating IPC communication using electron-ipc-decorator
 * This shows how to create reusable hooks for IPC calls with type safety
 *
 * 展示两种服务的使用：
 * 1. AppService - 应用相关功能（版本、语言切换等）
 * 2. ExampleService - 示例功能（ping、问候等）
 */
export function useIpcExample() {
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<string>('')

  // Example Service Methods - These are commented out as the example service doesn't exist
  const ping = async () => {
    setLoading(true)
    try {
      // Example service not available
      setResponse('Example service not available')
      toast.info('Example service not available')
      return 'Example service not available'
    } catch (error) {
      toast.error('Failed to ping')
      console.error(error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  const greet = async (name: string) => {
    setLoading(true)
    try {
      // Example service not available
      setResponse(`Hello ${name}!`)
      toast.success(`Hello ${name}!`)
      return `Hello ${name}!`
    } catch (error) {
      toast.error('Failed to greet')
      console.error(error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  const getSystemInfo = async () => {
    setLoading(true)
    try {
      // Get platform info from app service
      const platform = await ipcServices?.app.getPlatform()
      toast.success(`Platform: ${platform}`)
      return { platform }
    } catch (error) {
      toast.error('Failed to get system info')
      console.error(error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  // App Service Methods - 展示应用服务的使用
  const getAppVersion = async () => {
    setLoading(true)
    try {
      const version = await ipcServices?.app.getVersion()
      setResponse(`App Version: ${version}`)
      toast.success(`应用版本: ${version}`)
      return version
    } catch (error) {
      toast.error('获取应用版本失败')
      console.error(error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  const getAppInfo = async () => {
    setLoading(true)
    try {
      const version = await ipcServices?.app.getVersion()
      const platform = await ipcServices?.app.getPlatform()
      const info = { name: 'VidBee', version, platform }
      setResponse(`App: ${info.name} v${info.version} (${info.platform})`)
      toast.success(`应用: ${info.name} v${info.version}`)
      return info
    } catch (error) {
      toast.error('获取应用信息失败')
      console.error(error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  const switchAppLocale = async (_locale: string) => {
    setLoading(true)
    try {
      // Language switching not implemented in app service
      setResponse(`Language switching not implemented`)
      toast.info(`语言切换功能未实现`)
      return true
    } catch (error) {
      toast.error('切换语言失败')
      console.error(error)
      throw error
    } finally {
      setLoading(false)
    }
  }

  return {
    loading,
    response,
    // Example Service
    ping,
    greet,
    getSystemInfo,
    // App Service
    getAppVersion,
    getAppInfo,
    switchAppLocale
  }
}
