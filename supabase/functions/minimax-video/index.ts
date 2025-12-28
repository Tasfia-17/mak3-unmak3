import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface VideoRequest {
  prompt: string;
  firstFrameImage?: string;
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
  1013: 'Invalid parameters. Please check your video generation request.',
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { prompt, firstFrameImage, apiKey }: VideoRequest = await req.json();

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
          message: 'Video prompt is required.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Create video generation task
    const createTaskBody: any = {
      model: "video-01",
      prompt: prompt,
    };

    if (firstFrameImage) {
      createTaskBody.first_frame_image = firstFrameImage;
    }

    const createTaskResponse = await fetch('https://api.minimax.io/v1/video_generation', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createTaskBody),
    });

    const createTaskText = await createTaskResponse.text();

    if (!createTaskResponse.ok) {
      return new Response(
        JSON.stringify({
          error: `API error: ${createTaskResponse.status}`,
          message: `Failed to create video generation task. Status: ${createTaskResponse.status}`
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
          message: 'The API returned an invalid response when creating task.'
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
          message: 'Failed to get task ID from video generation request.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Poll for completion
    let fileId: string | null = null;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max (5 second intervals)

    while (attempts < maxAttempts && !fileId) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      const statusResponse = await fetch(`https://api.minimax.io/v1/query/video_generation?task_id=${taskId}`, {
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
            message: 'Video generation task failed.'
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
          message: 'Video generation timed out. Please try again.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Get download URL
    const videoUrl = `https://api.minimax.io/v1/files/retrieve?file_id=${fileId}`;

    return new Response(
      JSON.stringify({
        videoUrl: videoUrl,
        fileId: fileId,
        taskId: taskId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Video generation error:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        message: 'An unexpected error occurred during video generation.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
