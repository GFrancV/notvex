import { useEffect, useState } from 'react'

import { notvex } from '@/lib/ipc'

export function useIsDev(): boolean {
  const [isDev, setIsDev] = useState(false)

  useEffect(() => {
    void notvex.app.isDev().then((res) => {
      if (res.success) setIsDev(res.data)
    })
  }, [])

  return isDev
}
