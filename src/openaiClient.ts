// src/openaiClient.ts
import OpenAI from "openai";
import "dotenv/config";


if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY in environment variables');
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type PlanType = "free" | "premium";

export interface GeneratedRoutine {
  planType: PlanType;
  steps: string[];
}

export async function generateRoutineFromText(
  planType: PlanType,
  struggle: string,
  goal: string
): Promise<GeneratedRoutine> {
  const userPrompt = `
You are Clarity, an ADHD-friendly cleaning coach.

User struggle: ${struggle}
User goal: ${goal}
Plan type: ${planType === "free" ? "Free (short, gentle)" : "Premium (longer, detailed)"}.

Return a cleaning routine as a simple bullet list.
- 3 à 5 étapes pour le plan "free"
- 5 à 8 étapes pour le plan "premium"
- Langue: anglais simple
- Pas de texte avant/après, JUSTE la liste des étapes, une par ligne, sous forme de puces.
Example format:
• Step 1...
• Step 2...
• Step 3...
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // ou change le modèle si besoin
      messages: [
        {
          role: "system",
          content:
            "You are Clarity, a gentle ADHD-friendly cleaning coach. You always respond with clear bullet lists.",
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.7,
    });

    const content = completion.choices[0]?.message?.content || "";

    // Transforme le texte en tableau de steps
    const steps = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.replace(/^[-•*]\s*/, "").trim());

    if (!steps.length) {
      throw new Error("OpenAI returned empty routine");
    }

    return {
      planType,
      steps,
    };
  } catch (err) {
    console.error("❌ Error while calling OpenAI:", err);
    throw err;
  }
}
