import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import HelloWorld from './pages/HelloWorld.tsx'
import StreamingWorker from './pages/StreamingWorker.tsx'
import ContinuousWorker from './pages/ContinuousWorker.tsx'
import SttWorker from './pages/SttWorker.tsx'
import { SttWorkerPipelineProvider } from './SttWorkerPipelineContext.tsx'

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/hello_world" replace /> },
      { path: 'hello_world', element: <HelloWorld /> },
      { path: 'streaming_worker', element: <StreamingWorker /> },
      { path: 'continuous_streaming_worker', element: <ContinuousWorker /> },
      { path: 'real_stt_worker', element: <SttWorker /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SttWorkerPipelineProvider>
      <RouterProvider router={router} />
    </SttWorkerPipelineProvider>
  </StrictMode>,
)
