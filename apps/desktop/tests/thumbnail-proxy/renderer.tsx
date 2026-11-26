import { createStore, Provider, useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useCachedThumbnail } from '../../src/renderer/src/hooks/use-cached-thumbnail'
import { ipcServices } from '../../src/renderer/src/lib/ipc'
import { loadSettingsAtom, saveSettingAtom } from '../../src/renderer/src/store/settings'

const store = createStore()
let setUrl: (url: string | null) => void
let mounts = 0
let completions = 0

function Cover({ url }: { url: string | null }) {
  const thumbnail = useCachedThumbnail(url)
  useEffect(() => {
    mounts += 1
  }, [])
  return (
    <div>
      <output id="resolved">{thumbnail ?? 'missing'}</output>
      {thumbnail && <img alt="Diagnostic cover" id="cover" src={thumbnail} />}
    </div>
  )
}

function App() {
  const [url, updateUrl] = useState<string | null>(null)
  setUrl = updateUrl
  const load = useSetAtom(loadSettingsAtom)
  useEffect(() => {
    void load()
    const listener = window.api.on('settings:changed', () => {
      void load()
    })
    return () => window.api.removeListener('settings:changed', listener)
  }, [load])
  return <Cover url={url} />
}

window.probe = {
  async save(proxy: string) {
    await store.set(saveSettingAtom, { key: 'proxy', value: proxy })
    return ipcServices.settings.get('proxy')
  },
  show(url: string | null) {
    setUrl(url)
  },
  async raw(url: string) {
    const result = await ipcServices.thumbnail.getThumbnailPath(url)
    completions += 1
    return result
  },
  state() {
    return {
      mounts,
      completions,
      resolved: document.querySelector('#resolved')?.textContent,
      decoded: (document.querySelector('#cover') as HTMLImageElement)?.naturalWidth ?? 0
    }
  }
}

const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing regression renderer root')
}
createRoot(root).render(
  <Provider store={store}>
    <App />
  </Provider>
)
