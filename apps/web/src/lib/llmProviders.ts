// Multi-provider LLM config — shared by SetupWizard and LlmForm

export interface ProviderConfig {
  name: string;
  displayName: string;
  apiBaseUrl: string;
  flashModel: string;
  proModel: string;
  keyUrl: string;
  keyDescription: string;   // zh
  keyDescriptionEn: string;
  maxOutputTokens: number; // max tokens per LLM response (tool calls + text)
  contextWindow: number;  // model's total context window (input+output limit)
  hidden?: boolean;        // not shown in UI — no test key available yet
}

export const LLM_PROVIDERS: ProviderConfig[] = [
  {
    name: 'deepseek',
    displayName: 'DeepSeek',
    apiBaseUrl: 'https://api.deepseek.com',
    flashModel: 'deepseek-v4-flash',
    proModel: 'deepseek-v4-pro',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyDescription: '在 platform.deepseek.com 注册并获取 API Key（新用户有免费额度）',
    keyDescriptionEn: 'Get your API key at platform.deepseek.com (free credits for new users)',
    maxOutputTokens: 16000,  // 384K official, we use floor
    contextWindow: 1000000,  // 1M
  },
  {
    name: 'openai',
    displayName: 'OpenAI',
    hidden: true,
    apiBaseUrl: 'https://api.openai.com/v1',
    flashModel: 'gpt-4o-mini',
    proModel: 'gpt-4o',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyDescription: '在 platform.openai.com 创建 API Key。需绑定信用卡或预付费。',
    keyDescriptionEn: 'Create an API key at platform.openai.com. Requires a payment method.',
    maxOutputTokens: 16000,
    contextWindow: 128000,
  },
  {
    name: 'anthropic',
    displayName: 'Anthropic (Claude)',
    hidden: true,
    apiBaseUrl: 'https://api.anthropic.com/v1',
    flashModel: 'claude-3-5-haiku-latest',
    proModel: 'claude-sonnet-4-20250514',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyDescription: '在 console.anthropic.com 生成 API Key。需申请 API 访问权限。',
    keyDescriptionEn: 'Generate an API key at console.anthropic.com. API access may need approval.',
    maxOutputTokens: 16000,
    contextWindow: 200000,
  },
  {
    name: 'kimi',
    displayName: 'Kimi (Moonshot)',
    apiBaseUrl: 'https://api.moonshot.cn/v1',
    flashModel: 'kimi-k2.6',
    proModel: 'kimi-k3',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    keyDescription: '在 Moonshot 开放平台注册。⚠️ 需账户达到 Tier 1 及以上，否则限流严重无法正常使用。',
    keyDescriptionEn: 'Register at platform.moonshot.cn. ⚠️ Requires Tier 1+ account — free tier rate limits are too restrictive for AI agent use.',
    maxOutputTokens: 8192,  // K3: 128K, K2.6: 32K official; use safe floor
    contextWindow: 1000000, // K3: 1M
  },
  {
    name: 'qwen',
    displayName: 'Qwen (通义千问)',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    flashModel: 'qwen3.7-plus',  // 1M context, 65K output
    proModel: 'qwen3.8-max',     // 1M context, 128K output
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1',
    keyDescription: '在阿里云百炼平台开通 DashScope 并获取 API Key。国内用户友好。',
    keyDescriptionEn: 'Get an API key at Alibaba Cloud Bailian (DashScope).',
    maxOutputTokens: 8192,  // 3.7+: 65K, 3.8: 128K official; use safe floor
    contextWindow: 1000000, // 1M
  },
];

export function getProvider(name: string): ProviderConfig | undefined {
  return LLM_PROVIDERS.find(p => p.name === name);
}

export const DEFAULT_PROVIDER = 'deepseek';
