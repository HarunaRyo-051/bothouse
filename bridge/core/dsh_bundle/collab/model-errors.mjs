// Only an error-only turn is a failure; prose discussing an error remains a delivery.
const LEAD = String.raw`^(?:\W*(?:error|错误|出错了)\s*[:：]?\s*)?`;
const KINDS = [
  { kind: 'capacity', zh: '模型那边满载，稍后重试或换个模型。',
    re: new RegExp(`${LEAD}(?:selected model is at capacity|(?:the )?model is (?:currently )?(?:at capacity|overloaded)|overloaded(?:_error)?|模型(?:满载|过载))`, 'i') },
  { kind: 'quota', zh: '模型额度用完或被限流，等额度恢复或换个模型再试。',
    re: new RegExp(`${LEAD}(?:you'?ve hit your (?:usage |session )?limit|(?:usage|session|rate) limit (?:reached|exceeded)|rate.?limited|quota exceeded|resource_exhausted|too many requests|unexpected status 429|限流|额度(?:已)?用完)`, 'i') },
  { kind: 'timeout', zh: '模型请求超时，稍后重试。',
    re: new RegExp(`${LEAD}(?:stream disconnected before completion|(?:the )?request (?:has )?timed out|timed out waiting|deadline exceeded|请求超时)`, 'i') },
  { kind: 'auth', zh: '模型鉴权失败：Key 不对或登录过期，重新登录或检查 Key 后再试。',
    re: new RegExp(`${LEAD}(?:invalid (?:api )?key|incorrect api key|unauthorized|authentication (?:failed|error|required)|not logged in|please run /login|unexpected status 40[13]|鉴权失败)`, 'i') },
  { kind: 'context', zh: '模型上下文超限，缩短输入后再试。',
    re: new RegExp(`${LEAD}(?:context (?:length|window) (?:exceeded|limit)|maximum context length|prompt is too long|token limit exceeded|上下文(?:超限|过长))`, 'i') },
];

/** Error-only model reply, or undefined for a real reply. */
export function modelErrorReply(text) {
  const raw = String(text ?? '').trim();
  if (!raw || /\n\s*\n/.test(raw)) return undefined;
  const hit = KINDS.find(k => k.re.test(raw));
  return hit === undefined ? undefined : { kind: hit.kind, zh: hit.zh, raw };
}
