import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  AnalyticsRangeMetrics,
  SupplierAnalyticsMetrics,
} from '../types/marketplace.ts';

const GEMINI_MODEL = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  return getGeminiClient() !== null;
}

export interface GeneratedAiReportContent {
  aiGenerated: boolean;
  model?: string;
  statusMessage?: string;
  executiveSummary: string;
  highlights: string[];
  actionableRecommendations: string[];
  risksAndAlerts: string[];
}

export async function generateAdminAiReport(
  metrics: AnalyticsRangeMetrics
): Promise<GeneratedAiReportContent> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      aiGenerated: false,
      statusMessage:
        'AI summary unavailable because GEMINI_API_KEY is not configured in backend secrets. Showing verified database metrics and rule-based insights only.',
      executiveSummary:
        'Verified database analytics calculated below. Add GEMINI_API_KEY in Settings > Secrets to enable Gemini executive narratives.',
      highlights: metrics.calculatedInsights.slice(0, 3),
      actionableRecommendations: [],
      risksAndAlerts: metrics.availabilityIssues.map(
        (p) => `${p.title} has low/zero stock (${p.totalStock} remaining).`
      ),
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        'Analyze ONLY the verified marketplace database metrics below for TANZANITE EXPRESS and produce an accurate executive Business Intelligence report.',
        'Do NOT invent any numbers not present in the JSON payload. Cite only verified metrics.',
        JSON.stringify(metrics),
      ].join('\n\n'),
      config: {
        systemInstruction:
          'You are the Senior Marketplace Intelligence Analyst for TANZANITE EXPRESS, a multi-vendor fashion marketplace in Tanzania & globally. Base every insight strictly on the provided verified database JSON. Never fabricate figures.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveSummary: { type: Type.STRING },
            highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
            actionableRecommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
            risksAndAlerts: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            'executiveSummary',
            'highlights',
            'actionableRecommendations',
            'risksAndAlerts',
          ],
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim());
    return {
      aiGenerated: true,
      model: GEMINI_MODEL,
      executiveSummary: String(parsed.executiveSummary || 'Report generated from verified metrics.'),
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String) : [],
      actionableRecommendations: Array.isArray(parsed.actionableRecommendations)
        ? parsed.actionableRecommendations.map(String)
        : [],
      risksAndAlerts: Array.isArray(parsed.risksAndAlerts) ? parsed.risksAndAlerts.map(String) : [],
    };
  } catch (err: any) {
    return {
      aiGenerated: false,
      statusMessage: `AI report generation temporarily unavailable (${err?.message || 'API error'}). Verified database analytics remain active below.`,
      executiveSummary:
        'Verified database analytics calculated below. Gemini narrative generation could not complete for this request.',
      highlights: metrics.calculatedInsights.slice(0, 3),
      actionableRecommendations: [],
      risksAndAlerts: [],
    };
  }
}

export async function generateSupplierAiReport(
  metrics: SupplierAnalyticsMetrics,
  supplierName: string
): Promise<GeneratedAiReportContent> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      aiGenerated: false,
      statusMessage:
        'AI narrative unavailable because GEMINI_API_KEY is not configured. Verified supplier performance metrics remain active below.',
      executiveSummary: `Verified performance summary for ${supplierName} over ${metrics.rangeLabel}.`,
      highlights: metrics.suggestions.slice(0, 3),
      actionableRecommendations: metrics.suggestions,
      risksAndAlerts: metrics.restockAlerts.map(
        (r) => `${r.title} needs restocking (${r.totalStock} left).`
      ),
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        `Generate a private, practical supplier performance report for "${supplierName}" on TANZANITE EXPRESS using ONLY these verified metrics:`,
        JSON.stringify(metrics),
      ].join('\n\n'),
      config: {
        systemInstruction:
          'You are a fashion marketplace Merchandising & Fulfillment Advisor for TANZANITE EXPRESS. Address only the specific supplier metrics provided. Suggest concrete improvements for product descriptions, imagery, pricing competitiveness, stock management, and dispatch speed. Never fabricate numbers.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            executiveSummary: { type: Type.STRING },
            highlights: { type: Type.ARRAY, items: { type: Type.STRING } },
            actionableRecommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
            risksAndAlerts: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            'executiveSummary',
            'highlights',
            'actionableRecommendations',
            'risksAndAlerts',
          ],
        },
      },
    });

    const parsed = JSON.parse((response.text || '{}').trim());
    return {
      aiGenerated: true,
      model: GEMINI_MODEL,
      executiveSummary: String(parsed.executiveSummary || 'Supplier report generated.'),
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String) : [],
      actionableRecommendations: Array.isArray(parsed.actionableRecommendations)
        ? parsed.actionableRecommendations.map(String)
        : [],
      risksAndAlerts: Array.isArray(parsed.risksAndAlerts) ? parsed.risksAndAlerts.map(String) : [],
    };
  } catch (err: any) {
    return {
      aiGenerated: false,
      statusMessage: `AI narrative temporarily unavailable (${err?.message || 'API error'}). Verified metrics remain active.`,
      executiveSummary: `Verified metrics for ${supplierName} over ${metrics.rangeLabel}.`,
      highlights: metrics.suggestions.slice(0, 3),
      actionableRecommendations: metrics.suggestions,
      risksAndAlerts: [],
    };
  }
}

const PRIMARY_CHAT_TIMEOUT_MS = 7_500;
const FALLBACK_CHAT_TIMEOUT_MS = 14_000;
let primaryModelCooldownUntil = 0;

function detectQuestionLanguage(question: string, fallback: 'en' | 'sw'): 'en' | 'sw' {
  const q = question.toLowerCase();
  const swahiliCues = [
    'habari',
    'mambo',
    'sawa',
    'poa',
    'salama',
    'hujambo',
    'shikamoo',
    'marahaba',
    'huduma',
    'yako',
    'shukrani',
    'kwaheri',
    'nzuri',
    'za leo',
    'nisaidie',
    'msaada',
    'ninawezaje',
    'nawezaje',
    'mnapokea',
    'malipo',
    'nguo',
    'kuagiza',
    'kufuatilia',
    'kulipia',
    'sina uhakika',
    'tafadhali',
    'asante',
    'oda',
    'yangu',
    'bei',
    'shilingi',
    'kuuza',
    'msambazaji',
    'akaunti',
    'karibu',
    'je,',
    'vipi',
    'kurudisha',
  ];
  const englishCues = [
    'how ',
    'what ',
    'where ',
    'when ',
    'do you',
    'can i',
    'create an account',
    'register',
    'supplier',
    'jeans',
    'order',
    'track',
    'payment',
    'refund',
    'return',
    'shipping',
    'price',
    'hello',
    'good morning',
    'good afternoon',
    'good evening',
    'thank you',
    'thanks',
    'goodbye',
    'bye',
    'help',
  ];
  const swScore = swahiliCues.reduce((acc, cue) => (q.includes(cue) ? acc + 1 : acc), 0);
  const enScore = englishCues.reduce((acc, cue) => (q.includes(cue) ? acc + 1 : acc), 0);
  if (swScore > enScore) return 'sw';
  if (enScore > swScore) return 'en';
  return fallback;
}

export function getUnavailableAssistantMessage(lang: 'en' | 'sw'): string {
  return lang === 'sw'
    ? 'Samahani, huduma ya AI haipatikani kwa sasa. Tafadhali jaribu tena baada ya muda mfupi au wasiliana na timu yetu ya msaada.'
    : 'Sorry, the AI assistant service is currently unavailable. Please try again shortly or contact our support team.';
}

export interface SupportAssistantResult {
  reply: string;
  aiPowered: boolean;
  unavailable: boolean;
  suggestEscalation: boolean;
  replyLanguage: 'en' | 'sw';
  modelUsed?: string;
  errorCode?: string;
}

async function callGeminiWithTimeout(
  ai: GoogleGenAI,
  model: string,
  contents: string,
  systemInstruction: string,
  timeoutMs: number
): Promise<string> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const config: Record<string, unknown> = { systemInstruction };
    if (model === GEMINI_MODEL) {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
    }

    const generatePromise = ai.models.generateContent({
      model,
      contents,
      config,
    });

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        const timeoutErr = new Error(`Gemini request timed out after ${timeoutMs}ms`);
        (timeoutErr as any).code = 'GEMINI_TIMEOUT';
        reject(timeoutErr);
      }, timeoutMs);
    });

    const response = await Promise.race([generatePromise, timeoutPromise]);
    return (response.text || '').trim();
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export async function generateSupportAssistantReply(params: {
  question: string;
  history: { role: 'user' | 'assistant'; text: string }[];
  groundedContext: string;
  language: 'en' | 'sw';
}): Promise<SupportAssistantResult> {
  const replyLanguage = detectQuestionLanguage(params.question, params.language);
  const ai = getGeminiClient();
  const qLower = params.question.toLowerCase().trim();

  // Only suggest human escalation when user explicitly asks for a human/agent/complaint/dispute/refund/problem,
  // NOT on polite greetings, acknowledgements, or thanks like "Ok, asante", "Mambo", "Sawa", "Poa", "Thank you", "Bye".
  const isPoliteClosingOrGreeting =
    /^(ok|okay|sawa|poa|asante|shukrani|thank you|thanks|mambo|habari|hujambo|salama|karibu|bye|kwaheri|good morning|good afternoon|good evening|ok,?\s*asante|asante kwa huduma yako)[\s!.?,]*$/i.test(
      qLower
    );
  const suggestEscalation =
    !isPoliteClosingOrGreeting &&
    (qLower.includes('refund') ||
      qLower.includes('complaint') ||
      qLower.includes('dispute') ||
      qLower.includes('human') ||
      qLower.includes('agent') ||
      qLower.includes('talk to admin') ||
      qLower.includes('open ticket') ||
      qLower.includes('support ticket') ||
      qLower.includes('scam') ||
      qLower.includes('missing order') ||
      qLower.includes('wrong item') ||
      qLower.includes('damaged') ||
      qLower.includes('rudish') ||
      qLower.includes('lalamik') ||
      qLower.includes('tatizo kubwa') ||
      qLower.includes('mhudumu'));

  if (!ai) {
    console.warn('[Gemini Support Assistant] GEMINI_API_KEY is missing or unconfigured.');
    return {
      reply: getUnavailableAssistantMessage(replyLanguage),
      aiPowered: false,
      unavailable: true,
      suggestEscalation: true,
      replyLanguage,
      errorCode: 'GEMINI_KEY_MISSING',
    };
  }

  const transcript = params.history
    .slice(-10)
    .map((m) => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.text.slice(0, 1200)}`)
    .join('\n');

  const languageDirective =
    replyLanguage === 'sw'
      ? 'Reply naturally in Kiswahili.'
      : 'Reply naturally in English.';

  const contents = [
    'VERIFIED TANZANITE EXPRESS MARKETPLACE CONTEXT:',
    params.groundedContext,
    transcript ? `CONVERSATION HISTORY:\n${transcript}` : '',
    `CUSTOMER MESSAGE (${languageDirective}): ${params.question}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const systemInstruction = [
    'You are the official TANZANITE EXPRESS AI Shopping & Support Assistant ("Fashion You Love, Delivered to You").',
    'Handle ordinary greetings ("Habari", "Mambo", "Good morning"), acknowledgements ("Ok", "Sawa", "Poa"), gratitude ("Ok, asante", "Asante kwa huduma yako", "Thank you"), goodbyes ("Bye", "Kwaheri"), follow-up questions, and full multi-turn conversations naturally and warmly.',
    'When a user thanks you, acknowledges a previous message, greets you, or says goodbye, reply politely and naturally in the same language without forcing support tickets or showing errors.',
    'Also help customers browse products, understand categories, prices, sizes, and stock, create accounts, place orders, pay via M-Pesa or NMB Bank (using ONLY the exact account/phone details provided in the verified context), track orders, register for free as a supplier, and resolve support questions.',
    'Always reply in the same language as the customer (Kiswahili or English).',
    'Use ONLY facts from the verified marketplace context provided. Never invent products, prices, payment phone numbers, bank accounts, or another customer’s private order data.',
    'For account-specific disputes, missing deliveries, or payment verification delays, advise clicking "Talk to a Human Agent" / "Escalate to Human Support Ticket" ("Fungua Tiketi ya Msaada").',
    'Keep answers helpful, well-structured, accurate, and concise (under 180 words).',
  ].join(' ');

  const usePrimary = Date.now() >= primaryModelCooldownUntil;
  const candidateModels = usePrimary
    ? [GEMINI_MODEL, 'gemini-3.1-flash-lite']
    : ['gemini-3.1-flash-lite', GEMINI_MODEL];
  let lastErrorCode = 'GEMINI_API_ERROR';

  for (const model of candidateModels) {
    const timeoutMs =
      model === GEMINI_MODEL ? PRIMARY_CHAT_TIMEOUT_MS : FALLBACK_CHAT_TIMEOUT_MS;
    try {
      const text = await callGeminiWithTimeout(
        ai,
        model,
        contents,
        systemInstruction,
        timeoutMs
      );
      if (text) {
        return {
          reply: text,
          aiPowered: true,
          unavailable: false,
          suggestEscalation,
          replyLanguage,
          modelUsed: model,
        };
      }
      lastErrorCode = 'GEMINI_EMPTY_RESPONSE';
      console.error(`[Gemini Support Assistant] Empty response text from model ${model}.`);
    } catch (err: any) {
      const status = err?.status || err?.statusCode || 'UNKNOWN';
      const code = err?.code || 'GEMINI_API_ERROR';
      const rawMsg = String(err?.message || 'Unknown Gemini error').slice(0, 220);
      lastErrorCode = typeof status === 'number' ? `GEMINI_HTTP_${status}` : String(code);
      console.error('[Gemini Support Assistant Error]', { model, status, code, message: rawMsg });

      if (model === GEMINI_MODEL && (status === 503 || status === 500 || code === 'GEMINI_TIMEOUT')) {
        primaryModelCooldownUntil = Date.now() + 5 * 60 * 1000;
      }

      // Do not retry secondary model if API key itself is invalid/unauthorized
      if (status === 401 || status === 403 || rawMsg.toLowerCase().includes('api key')) {
        lastErrorCode = `GEMINI_AUTH_${status}`;
        break;
      }
    }
  }

  return {
    reply: getUnavailableAssistantMessage(replyLanguage),
    aiPowered: false,
    unavailable: true,
    suggestEscalation: true,
    replyLanguage,
    errorCode: lastErrorCode,
  };
}
