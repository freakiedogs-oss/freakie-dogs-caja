import { useState } from 'react'
import POSLogin from './POSLogin'
import POSMain from './cajero/POSMain'

export default function POSApp() {
  const [user, setUser] = useState(null)

  const handleLogout = () => setUser(null)

  if (!user) return <POSLogin onLogin={setUser} />
  return <POSMain user={user} onLogout={handleLogout} />
}
