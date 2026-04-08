import { GoogleGenAI } from "@google/genai";
import config from "../config/env.js";

const systemPrompt = `
Eres un barbero profesional experto en:
- cortes de cabello
- barba
- estilos modernos
- cuidado capilar masculino
- recomendaciones de barbería

Reglas:
- Responde como si fuera un chat de WhatsApp
- Responde de forma corta, clara y natural
- No saludes
- No hagas preguntas adicionales
- No generes conversación
- Solo responde lo que el usuario pregunta
- Máximo 3 o 4 líneas

Si la pregunta no está relacionada con barbería, responde:
"Solo puedo ayudarte con temas relacionados con cortes, barba y barbería."
`;

const client = new GoogleGenAI({
  apiKey: config.GEMINI_API_KEY,
});

const geminiAiService = async (message) => {
  try {
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: systemPrompt,
      },
      contents: message,
    });

    return response.text;
  } catch (error) {
    console.error("❌ Error en Gemini:", error);
    return "Lo siento, en este momento no puedo responder esa consulta.";
  }
};

export default geminiAiService;