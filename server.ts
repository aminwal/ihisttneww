import express from "express";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // AI Proxy Endpoint
  app.post("/api/generate", async (req, res) => {
    try {
      const { model, contents, config } = req.body;
      
      // 1. Try to get API Keys from database
      let apiKeys = [process.env.GEMINI_API_KEY, process.env.API_KEY].filter(Boolean) as string[];
      
      try {
        const { data: configData } = await supabase.from('school_config').select('config_data').eq('id', 'primary_config').single();
        if (configData?.config_data?.geminiApiKeys && Array.isArray(configData.config_data.geminiApiKeys)) {
          apiKeys = [...apiKeys, ...configData.config_data.geminiApiKeys];
        }
      } catch (dbError) {
        console.warn("Could not fetch API keys from database, falling back to environment variables.");
      }
      
      if (apiKeys.length === 0) {
        return res.status(500).json({ 
          error: "GATING_ERROR: Gemini API Keys are missing. Please configure them in the Admin Console or Environment Variables." 
        });
      }

      // Try keys until one works
      let response;
      let lastError;
      for (const apiKey of apiKeys) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          response = await ai.models.generateContent({
            model: model || "gemini-3-flash-preview",
            contents,
            config
          });
          break; // Success
        } catch (error: any) {
          lastError = error;
          console.warn("API Key failed, trying next key...");
          continue;
        }
      }

      if (!response) {
        throw lastError || new Error("All API keys failed");
      }

      res.json(response);
    } catch (error: any) {
      console.error("AI Proxy Error:", error);
      res.status(500).json({ 
        error: error.message || "An error occurred during AI generation" 
      });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", environment: process.env.NODE_ENV });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve the dist folder
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Only listen if not on Vercel
  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }

  return app;
}

const appPromise = startServer();
export default appPromise;
