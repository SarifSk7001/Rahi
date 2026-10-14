import { useState } from 'react'
import { POLICE_STATIONS, loginStation } from './policeData'

export default function PoliceLogin({ onSuccess, onBack }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(event) {
    event.preventDefault()
    const station = loginStation(name, password)
    if (!station) {
      setError('Wrong thana name or password.')
      return
    }
    setError('')
    onSuccess(station)
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-row">
          <div>
            <h1>NAGAR AI · CoolWalk</h1>
            <p>Police station portal</p>
          </div>
          <button type="button" className="ghost-btn" onClick={onBack}>
            ← Back to app
          </button>
        </div>
      </header>

      <div className="login-wrap">
        <form className="login-card search" onSubmit={handleSubmit}>
          <h2>Police Station Login</h2>
          <p className="footnote">
            Sign in to receive SOS alerts from citizens near your thana.
          </p>

          <label className="field">
            <span>Thana name</span>
            <input
              list="thana-list"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hare Street"
              autoComplete="off"
              required
            />
            <datalist id="thana-list">
              {POLICE_STATIONS.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <p className="error" role="alert">{error}</p>}

          <button className="primary-btn" type="submit">Login</button>

          <p className="footnote">
            Prototype demo: thana <strong>Hare Street</strong>, password <strong>hare123</strong>.
          </p>
        </form>
      </div>
    </div>
  )
}
