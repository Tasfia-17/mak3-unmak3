import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AudioRequest {
  text: string;
  voiceId?: string;
  model?: string;
  speed?: number;
  emotion?: string;
  apiKey?: string;
}

const ERROR_MESSAGES: Record<number, string> = {
  1004: 'Authentication failed. Please check your API key.',
  1008: 'Insufficient balance. Please add funds to your Minimax account at https://platform.minimax.io/user-center/payment/balance',
  1002: 'Rate limited. Please wait a moment and try again.',
  1013: 'Invalid parameters. Please check your audio generation request.',
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { text, voiceId, model, speed, emotion, apiKey }: AudioRequest = await req.json();

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'API key not provided',
          message: 'Please set your VITE_MINIMAX_API_KEY environment variable.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!text) {
      return new Response(
        JSON.stringify({
          error: 'Missing text',
          message: 'Text content is required for audio generation.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const requestBody: any = {
      model: model || "speech-01-hd",
      text: text,
      stream: false,
      voice_setting: {
        voice_id: voiceId || "male-qn-qingse",
        speed: speed || 1.0,
        vol: 1.0,
        pitch: 0,
      }
    };

    if (emotion) {
      requestBody.voice_setting.emotion = emotion;
    }

    const audioResponse = await fetch('https://api.minimax.io/v1/t2a_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!audioResponse.ok) {
      return new Response(
        JSON.stringify({
          error: `API error: ${audioResponse.status}`,
          message: `Failed to generate audio. Status: ${audioResponse.status}`
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const responseText = await audioResponse.text();
    let audioData: any;

    try {
      audioData = JSON.parse(responseText);
    } catch {
      return new Response(
        JSON.stringify({
          error: 'Invalid response',
          message: 'The API returned an invalid response.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (audioData.base_resp?.status_code && audioData.base_resp.status_code !== 0) {
      const errorCode = audioData.base_resp.status_code;
      const errorMessage = ERROR_MESSAGES[errorCode] || audioData.base_resp.status_msg || 'Unknown error';

      return new Response(
        JSON.stringify({
          error: `Error ${errorCode}`,
          message: errorMessage
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!audioData.data?.audio) {
      return new Response(
        JSON.stringify({
          error: 'No audio data',
          message: 'The API did not return audio data.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return base64 audio data
    return new Response(
      JSON.stringify({
        audioData: audioData.data.audio,
        audioUrl: `data:audio/mp3;base64,${audioData.data.audio}`,
        usage: audioData.usage
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Audio generation error:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        message: 'An unexpected error occurred during audio generation.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
