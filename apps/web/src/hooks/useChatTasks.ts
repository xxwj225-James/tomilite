import { useState, useRef, useCallback } from 'react';

// ═══ Task-based streaming — each send creates an independent task with own SSE stream ═══

export interface ChatTask {
  id: string;
  threadId: string;
  status: 'streaming' | 'done' | 'error' | 'aborted';
  content: string;
  reasoningContent: string;
  iteration: number;
  agentStatus: string;
  controller: AbortController;
  assistantIdx: number;
  card?: any;
  staged?: any;
}

export function useChatTasks() {
  const [tasks, setTasks] = useState<Record<string, ChatTask>>({});
  const tasksRef = useRef<Record<string, ChatTask>>({});
  // Soft cap: browser ~6 connections per origin, keep headroom for panels
  const MAX_CONCURRENT = 4;

  const updateTask = useCallback((taskId: string, patch: Partial<ChatTask>) => {
    tasksRef.current = { ...tasksRef.current, [taskId]: { ...tasksRef.current[taskId], ...patch } };
    setTasks(prev => ({ ...prev, [taskId]: { ...prev[taskId], ...patch } }));
  }, []);

  const addTask = useCallback((task: ChatTask) => {
    tasksRef.current = { ...tasksRef.current, [task.id]: task };
    setTasks(prev => ({ ...prev, [task.id]: task }));
  }, []);

  const removeTask = useCallback((taskId: string) => {
    const next = { ...tasksRef.current };
    delete next[taskId];
    tasksRef.current = next;
    setTasks(prev => { const n = { ...prev }; delete n[taskId]; return n; });
  }, []);

  const stopTask = useCallback((taskId: string) => {
    const t = tasksRef.current[taskId];
    if (t?.controller) t.controller.abort();
    removeTask(taskId);
  }, [removeTask]);

  const stopThreadTasks = useCallback((threadId: string) => {
    Object.values(tasksRef.current).forEach(t => {
      if (t.threadId === threadId) stopTask(t.id);
    });
  }, [stopTask]);

  const stopAll = useCallback(() => {
    Object.keys(tasksRef.current).forEach(stopTask);
  }, [stopTask]);

  // Count active tasks for a thread
  const activeCount = useCallback((threadId: string) => {
    return Object.values(tasksRef.current).filter(t => t.threadId === threadId && t.status === 'streaming').length;
  }, []);

  // Get tasks for a thread
  const threadTasks = useCallback((threadId: string) => {
    return Object.values(tasksRef.current).filter(t => t.threadId === threadId);
  }, []);

  // Check if any task in a thread is still streaming (for UI thinking indicator)
  const isThreadThinking = useCallback((threadId: string) => {
    return Object.values(tasksRef.current).some(t => t.threadId === threadId && t.status === 'streaming');
  }, []);

  return {
    tasks, tasksRef,
    addTask, updateTask, removeTask,
    stopTask, stopThreadTasks, stopAll,
    activeCount, threadTasks, isThreadThinking,
    MAX_CONCURRENT,
  };
}
