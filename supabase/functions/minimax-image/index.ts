import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ImageRequest {
  prompt: string;
  apiKey?: string;
}

interface MinimaxTaskResponse {
  task_id: string;
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
}

interface MinimaxStatusResponse {
  status: string;
  file_id?: string;
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
}

const ERROR_MESSAGES: Record<number, string> = {
  1004: 'Authentication failed. Please check your API key.',
  1008: 'Insufficient balance. Please add funds to your Minimax account at https://platform.minimax.io/user-center/payment/balance',
  1002: 'Rate limited. Please wait a moment and try again.',
  1013: 'Invalid parameters. Please check your image generation request.',
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { prompt, apiKey }: ImageRequest = await req.json();

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'API key not provided',
          message: 'Please set your VITE_MINIMAX_API_KEY environment variable.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!prompt) {
      return new Response(
        JSON.stringify({
          error: 'Missing prompt',
          message: 'Image generation prompt is required.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Create image generation task
    const createTaskResponse = await fetch('https://api.minimax.io/v1/image_generation', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'image-generation-01',
        prompt: prompt,
        aspect_ratio: '1:1',
        num_inference_steps: 50,
      }),
    });

    const createTaskText = await createTaskResponse.text();

    if (!createTaskResponse.ok) {
      return new Response(
        JSON.stringify({
          error: `API error: ${createTaskResponse.status}`,
          message: `Failed to create image generation task. Status: ${createTaskResponse.status}`,
          details: createTaskText
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let taskData: MinimaxTaskResponse;
    try {
      taskData = JSON.parse(createTaskText);
    } catch {
      return new Response(
        JSON.stringify({
          error: 'Invalid response',
          message: 'The API returned an invalid response when creating task.',
          details: createTaskText
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (taskData.base_resp?.status_code && taskData.base_resp.status_code !== 0) {
      const errorCode = taskData.base_resp.status_code;
      const errorMessage = ERROR_MESSAGES[errorCode] || taskData.base_resp.status_msg || 'Unknown error';

      return new Response(
        JSON.stringify({
          error: `Error ${errorCode}`,
          message: errorMessage
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const taskId = taskData.task_id;

    if (!taskId) {
      return new Response(
        JSON.stringify({
          error: 'No task ID',
          message: 'Failed to get task ID from image generation request.',
          details: createTaskText
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Poll for completion
    let fileId: string | null = null;
    let attempts = 0;
    const maxAttempts = 30; // 2.5 minutes max (5 second intervals)

    while (attempts < maxAttempts && !fileId) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      const statusResponse = await fetch(`https://api.minimax.io/v1/query/image_generation?task_id=${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      const statusText = await statusResponse.text();
      let statusData: MinimaxStatusResponse;

      try {
        statusData = JSON.parse(statusText);
      } catch {
        attempts++;
        continue;
      }

      if (statusData.base_resp?.status_code && statusData.base_resp.status_code !== 0) {
        const errorCode = statusData.base_resp.status_code;
        const errorMessage = ERROR_MESSAGES[errorCode] || statusData.base_resp.status_msg || 'Unknown error';

        return new Response(
          JSON.stringify({
            error: `Error ${errorCode}`,
            message: errorMessage
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (statusData.status === 'Success' && statusData.file_id) {
        fileId = statusData.file_id;
        break;
      } else if (statusData.status === 'Failed') {
        return new Response(
          JSON.stringify({
            error: 'Generation failed',
            message: 'Image generation task failed.'
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      attempts++;
    }

    if (!fileId) {
      return new Response(
        JSON.stringify({
          error: 'Timeout',
          message: 'Image generation timed out. Please try again.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Get download URL
    const imageUrl = `https://api.minimax.io/v1/files/retrieve?file_id=${fileId}`;

    return new Response(
      JSON.stringify({
        imageUrl: imageUrl,
        fileId: fileId,
        taskId: taskId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Image generation error:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        message: 'An unexpected error occurred during image generation.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
