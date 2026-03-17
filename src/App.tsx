import { NavLink, Outlet } from 'react-router-dom'
import './App.css'

export default function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', width: "100%" }}>
      <nav style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '1px solid #333', paddingBottom: '1rem' }}>
        <NavLink to="/hello_world">Hello World WASM</NavLink>
        <NavLink to="/streaming_worker">Streaming WASM Worker</NavLink>
        <NavLink to="/continuous_worker">Continuous WASM Worker</NavLink>
        <NavLink to="/real_stt_worker">STT WASM Worker</NavLink>
      </nav>
      <Outlet />
    </div>
  )
}
