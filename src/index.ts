// src/index.ts
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { openai } from './openaiClient';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

type PlanType = 'free' | 'premium';

interface RoutineStep {
  title?: string;
  description: string;
  durationMinutes?: number;
}

// ---------- MIDDLEWARE ----------
app.use(
  cors({
    origin: '*', // tu pourras restreindre pour la prod
  })
);
app.use(bodyParser.json({ limit: '25mb' }));

// ---------- HEALTH ----------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ---------- ROUTINE FROM TEXT (onboarding / texte) ----------
app.post('/api/routines/from-text', async (req, res) => {
  const { planType, struggle, goal } = req.body as {
    planType?: PlanType;
    struggle?: string;
    goal?: string;
  };

  if (!struggle || !goal) {
    return res.status(400).json({ error: 'struggle and goal are required' });
  }

  const safePlanType: PlanType = planType === 'premium' ? 'premium' : 'free';

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      temperature: 0.8,
      messages: [
        {
          role: 'system',
          content:
            'You are Clarity, a warm ADHD-friendly cleaning coach. ' +
            'You create tiny, kind micro-routines based on a user struggle and goal. ' +
            'Always respond with STRICT JSON ONLY matching: ' +
            '{ "summary": string, "steps": [ { "title": string, "description": string, "durationMinutes": number } ] }. ' +
            'Use 3–5 steps for free, 5–8 for premium. Each step should be 1–5 minutes. ' +
            'Be gentle and non-judgmental.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            planType: safePlanType,
            struggle,
            goal,
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Empty completion content');

    const parsed = JSON.parse(content) as {
      summary?: string;
      steps?: RoutineStep[];
    };

    res.json({
      planType: safePlanType,
      summary: parsed.summary ?? '',
      steps: parsed.steps ?? [],
    });
  } catch (err) {
    console.error('Error in /api/routines/from-text:', err);
    res.status(500).json({ error: 'Failed to generate routine' });
  }
});

// ---------- ROUTINE FROM PHOTO (vision) ----------
app.post('/api/routines/from-photo', async (req, res) => {
  const { planType, roomName, goal, notes, imageBase64 } = req.body as {
    planType?: PlanType;
    roomName?: string;
    goal?: string;
    notes?: string;
    imageBase64?: string; // base64 sans "data:image/jpeg;base64,"
  };

  if (!imageBase64) {
    return res.status(400).json({ error: 'imageBase64 is required' });
  }

  const safePlanType: PlanType = planType === 'premium' ? 'premium' : 'free';

  try {
    const imageUrl = `data:image/jpeg;base64,${imageBase64}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1', // vision
      response_format: { type: 'json_object' },
      temperature: 0.8, // variantes possibles
      messages: [
        {
          role: 'system',
          content:
            'You are Clarity, an ADHD-friendly home organization AI. ' +
            'You analyze a room photo and create a gentle, realistic micro-routine. ' +
            'You MUST respond with JSON ONLY, matching: ' +
            '{ "scanSummary": string, "hotspots": string[], "summary": string, ' +
            '"steps": [ { "title": string, "description": string, "durationMinutes": number } ] }. ' +
            'Use 3–5 steps for free, 5–8 steps for premium. Be very kind and non-judgmental. ' +
            'When asked multiple times for the same photo, vary the routine (don’t repeat wording verbatim).',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `Plan type: ${safePlanType}\n` +
                `Room name: ${roomName || 'Unknown room'}\n` +
                `User goal: ${goal || 'No specific goal'}\n` +
                `Extra notes: ${notes || 'None'}\n\n` +
                'Tasks:\n' +
                '1) Identify clutter hotspots.\n' +
                '2) Summarize what you see.\n' +
                '3) Propose a tiny routine they can do today.',
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl }, // ✅ format Chat Completions
            },
          ],
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Empty completion content from vision');

    const parsed = JSON.parse(content) as {
      scanSummary?: string;
      hotspots?: string[];
      summary?: string;
      steps?: RoutineStep[];
    };

    res.json({
      planType: safePlanType,
      scanSummary: parsed.scanSummary ?? '',
      hotspots: parsed.hotspots ?? [],
      summary: parsed.summary ?? '',
      steps: parsed.steps ?? [],
    });
  } catch (err) {
    console.error('Error in /api/routines/from-photo:', err);
    res.status(500).json({ error: 'Failed to generate routine from photo' });
  }
});

// ---------- QUICK ROUTINES (overwhelmed / 5min / guests / lowenergy) ----------
app.post('/api/quick-routine', async (req, res) => {
  const { preset, planType } = req.body as {
    preset: 'overwhelmed' | 'fiveMin' | 'guests' | 'lowEnergy';
    planType?: PlanType;
  };

  if (!preset) {
    return res.status(400).json({ error: 'preset is required' });
  }

  const safePlanType: PlanType = planType === 'premium' ? 'premium' : 'free';

  const presetDescriptionMap: Record<string, string> = {
    overwhelmed:
      'User feels overwhelmed. Needs very gentle, kind, tiny steps. Focus on calming + visible relief.',
    fiveMin:
      'Exactly a 5-minute reset. Keep it tight. Prioritize visible wins in one small area.',
    guests:
      'Guests are coming soon. Focus on areas guests see first: entryway, main surfaces, quick bathroom check.',
    lowEnergy:
      'User is in very low energy. Steps must be extremely small, sit-friendly if possible, and permission to stop.',
  };

  const titleMap: Record<string, string> = {
    overwhelmed: 'I feel overwhelmed',
    fiveMin: '5-minute reset',
    guests: 'Guests are coming',
    lowEnergy: 'Low-energy mode',
  };

  const subtitleMap: Record<string, string> = {
    overwhelmed: 'A gentle reset when everything feels too much.',
    fiveMin: 'A quick reset to regain clarity.',
    guests: 'Make your space presentable fast.',
    lowEnergy: 'Very small steps for difficult days.',
  };

  const presetDescription = presetDescriptionMap[preset] ?? 'Generic quick routine';

  const baseConstraints =
    safePlanType === 'free'
      ? 'Return 3–5 steps max.'
      : 'Return 5–8 steps, a bit more detailed.';

  const specialConstraints =
    preset === 'fiveMin'
      ? 'Exactly 4–5 steps. Each step must be doable in ~60 seconds. Step 1 MUST be: "Set a 5-minute timer." Total should feel like ~5 minutes.'
      : '';

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      response_format: { type: 'json_object' },
      temperature: 0.9,
      messages: [
        {
          role: 'system',
          content:
            'You are Clarity, an ADHD-friendly cleaning assistant. ' +
            'You generate quick micro-routines for different emotional modes. ' +
            'You MUST respond with JSON ONLY: { "steps": string[] }. ' +
            'Each step = 1 short sentence, gentle tone, doable in under 1–2 minutes. ' +
            'IMPORTANT: If asked again for the same preset, produce a DIFFERENT routine: ' +
            'vary actions, order, focus area, and wording; do not repeat steps verbatim.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            preset,
            planType: safePlanType,
            description: presetDescription,
            constraints: [baseConstraints, specialConstraints].filter(Boolean).join(' '),
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Empty completion content for quick routine');

    const parsed = JSON.parse(content) as { steps?: string[] };

    res.json({
      preset,
      title: titleMap[preset] ?? 'Quick routine',
      subtitle: subtitleMap[preset] ?? '',
      steps: parsed.steps ?? [],
      planType: safePlanType,
    });
  } catch (err) {
    console.error('Error in /api/quick-routine:', err);
    res.status(500).json({ error: 'Failed to generate quick routine' });
  }
});

// ---------- START SERVER ----------
app.listen(PORT, () => {
  console.log(`Clarity backend running on http://localhost:${PORT}`);
});