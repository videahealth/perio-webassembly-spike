import { createContext, useContext, type ReactNode } from 'react'
import { useSttWorkerPipeline } from './useSttWorkerPipeline'

type SttWorkerPipelineContextType = ReturnType<typeof useSttWorkerPipeline>

const SttWorkerPipelineContext = createContext<SttWorkerPipelineContextType | null>(null)

export function SttWorkerPipelineProvider({ children }: { children: ReactNode }) {
  const pipeline = useSttWorkerPipeline()
  return (
    <SttWorkerPipelineContext.Provider value={pipeline}>
      {children}
    </SttWorkerPipelineContext.Provider>
  )
}

export function useSttPipeline(): SttWorkerPipelineContextType {
  const ctx = useContext(SttWorkerPipelineContext)
  if (!ctx) throw new Error('useSttPipeline must be used within SttWorkerPipelineProvider')
  return ctx
}
