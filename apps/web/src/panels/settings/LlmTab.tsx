import { LlmForm } from "@/components/settings/LlmForm";

export function LlmTab() {
  return (
    <div className="card"><div className="card-hd"><span style={{display:'inline-flex',alignItems:'center',gap:4}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.8 5.5 5.7.7-4.3 3.8 1.3 5.5-4.5-3.3-4.5 3.3 1.3-5.5-4.3-3.8 5.7-.7z"/><path d="M19 1l.5 1.5L21 3l-1.5.5L19 5l-.5-1.5L17 3l1.5-.5z"/></svg> LLM</span></div>
      <div className="card-bd">
        <LlmForm standalone />
      </div>
    </div>
  );
}
