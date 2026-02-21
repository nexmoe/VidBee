import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { type ErrorInfo as ErrorInfoType, ErrorPage } from './ErrorPage'

interface Props {
  children: ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
  fallback?: (errorInfo: ErrorInfoType) => ReactNode
}

interface State {
  hasError: boolean
  errorInfo: ErrorInfoType | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      errorInfo: null
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    const errorInfo = {
      error,
      timestamp: Date.now(),
      context: {
        url: window.location.href,
        userAgent: navigator.userAgent,
        platform: navigator.platform
      }
    }

    // Log error details immediately
    logger.error('ErrorBoundary: getDerivedStateFromError called', {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      url: errorInfo.context.url,
      timestamp: errorInfo.timestamp
    })

    return {
      hasError: true,
      errorInfo
    }
  }

  async componentDidCatch(error: Error, errorInfo: ErrorInfo): Promise<void> {
    logger.error('ErrorBoundary caught an error:', {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      componentStack: errorInfo.componentStack,
      errorInfo: JSON.stringify(errorInfo, null, 2)
    })

    // Get app version if available
    let appVersion: string | undefined
    try {
      if (window?.api && ipcServices?.app) {
        appVersion = await ipcServices.app.getVersion()
        logger.info('ErrorBoundary: App version retrieved', { appVersion })
      }
    } catch (err) {
      logger.warn('Failed to get app version:', err)
    }

    // Update state with component stack and version
    if (this.state.errorInfo) {
      this.setState({
        errorInfo: {
          ...this.state.errorInfo,
          context: {
            ...this.state.errorInfo.context,
            version: appVersion
          },
          errorInfo: {
            componentStack: errorInfo.componentStack || undefined
          }
        }
      })
    }

    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }

    // Send error to main process if available
    if (window?.api) {
      try {
        window.api.send('error:renderer', {
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack
          },
          errorInfo: {
            componentStack: errorInfo.componentStack
          },
          timestamp: Date.now(),
          context: {
            url: window.location.href,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            version: appVersion
          }
        })
      } catch (err) {
        logger.error('Failed to send error to main process:', err)
      }
    }
  }

  handleReload = (): void => {
    this.setState({
      hasError: false,
      errorInfo: null
    })
    window.location.reload()
  }

  handleGoHome = (): void => {
    this.setState({
      hasError: false,
      errorInfo: null
    })
    window.location.hash = '/'
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.errorInfo) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.errorInfo)
      }
      return (
        <ErrorPage
          errorInfo={this.state.errorInfo}
          onGoHome={this.handleGoHome}
          onReload={this.handleReload}
        />
      )
    }

    return this.props.children
  }
}
