import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface VisionRequest {
  imageBase64: string;
  apiKey?: string;
}

const ERROR_MESSAGES: Record<number, string> = {
  1004: 'Authentication failed. Please check your API key.',
  1008: 'Insufficient balance. Please add funds to your Minimax account at https://platform.minimax.io/user-center/payment/balance',
  1002: 'Rate limited. Please wait a moment and try again.',
  1039: 'Token limit exceeded. Please try a shorter prompt.',
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { imageBase64, apiKey }: VisionRequest = await req.json();

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'API key not provided',
          message: 'Please set your VITE_MINIMAX_API_KEY environment variable.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!imageBase64) {
      return new Response(
        JSON.stringify({
          error: 'Missing image data',
          message: 'Image base64 data is required.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemInstruction = `You are an expert computer vision system specialized in object detection and localization.

TASK: Analyze the provided image and identify ALL physical objects present.

For each detected object, provide:
1. NAME: A clear, descriptive name for the object
2. BOUNDING BOX: Normalized coordinates [ymin, xmin, ymax, xmax] where values range from 0-1000

GUIDELINES:
- Focus on primary, distinct physical objects (not backgrounds or surfaces)
- Be specific with names (e.g., "ceiling fan" not just "fan")
- Ensure bounding boxes tightly fit each object
- Return ONLY valid JSON in the exact format shown below
- If multiple similar objects exist, identify each one separately
- The bounding box coordinates should be normalized to 0-1000 scale

REQUIRED OUTPUT FORMAT:
{
  "objects": [
    {
      "name": "ceiling fan",
      "box_2d": [100, 200, 600, 800]
    },
    {
      "name": "light fixture",
      "box_2d": [50, 100, 300, 500]
    }
  ]
}

CRITICAL: Return ONLY the JSON object. Do not include any explanatory text before or after the JSON.`;

    const minimaxResponse = await fetch('https://api.minimax.io/v1/text/chatcompletion_v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2',
        messages: [
          {
            role: 'system',
            content: systemInstruction
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64
                }
              },
              {
                type: 'text',
                text: 'Identify all primary physical objects in this image and provide their normalized bounding boxes [ymin, xmin, ymax, xmax] (0-1000). Return ONLY valid JSON.'
              }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    const responseText = await minimaxResponse.text();
    console.log('Minimax API response status:', minimaxResponse.status);
    console.log('Minimax API response (first 500 chars):', responseText.substring(0, 500));

    if (!minimaxResponse.ok) {
      console.error('Minimax API error:', responseText);
      return new Response(
        JSON.stringify({
          error: `API error: ${minimaxResponse.status}`,
          message: `Minimax API returned error ${minimaxResponse.status}.`,
          details: responseText
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let minimaxData;
    try {
      minimaxData = JSON.parse(responseText);
    } catch {
      return new Response(
        JSON.stringify({
          error: 'Invalid response',
          message: 'The API returned an invalid response.',
          details: responseText
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (minimaxData.base_resp?.status_code && minimaxData.base_resp.status_code !== 0) {
      const errorCode = minimaxData.base_resp.status_code;
      const errorMessage = ERROR_MESSAGES[errorCode] || minimaxData.base_resp.status_msg || 'Unknown error';

      return new Response(
        JSON.stringify({
          error: `Error ${errorCode}`,
          message: errorMessage
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const assistantMessage = minimaxData.choices?.[0]?.message?.content;
    console.log('Assistant message:', assistantMessage?.substring(0, 300));

    if (!assistantMessage) {
      console.error('No assistant message in response');
      return new Response(
        JSON.stringify({
          error: 'No response',
          message: 'The AI did not generate a response. Please try again.',
          rawResponse: minimaxData
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the JSON response from the AI
    let detectionResult;
    try {
      detectionResult = JSON.parse(assistantMessage);
      console.log('Successfully parsed detection result:', JSON.stringify(detectionResult).substring(0, 200));
    } catch (parseError) {
      console.error('Failed to parse assistant message:', parseError, 'Message:', assistantMessage);
      return new Response(
        JSON.stringify({
          error: 'Invalid detection format',
          message: 'Failed to parse object detection results.',
          details: assistantMessage
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        objects: detectionResult.objects || [],
        usage: minimaxData.usage
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Vision detection error:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        message: 'An unexpected error occurred during object detection.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
