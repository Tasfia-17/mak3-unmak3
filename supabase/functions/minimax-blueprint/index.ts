import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface BlueprintRequest {
  imageBase64: string;
  objectName: string;
  mode: 'assembly' | 'disassembly';
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
    const { imageBase64, objectName, mode, apiKey }: BlueprintRequest = await req.json();

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: 'API key not provided',
          message: 'Please set your VITE_MINIMAX_API_KEY environment variable.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!imageBase64 || !objectName || !mode) {
      return new Response(
        JSON.stringify({
          error: 'Missing required fields',
          message: 'Image, object name, and mode are required.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const systemInstruction = `You are an Expert Reverse Engineer and Mechanical Illustrator specializing in deconstructing physical objects into educational blueprints.

ROLE:
- Analyze the object "${objectName}" in the provided image
- Create a fictional but plausible ${mode} guide that balances technical accuracy with educational storytelling
- Generate detailed prompts for AI video and diagram generation

GENERATION REQUIREMENTS:

1. TITLE: Create an archival-style name that sounds technical and authoritative (e.g., "Mark IV Rotary Blade Assembly System")

2. MATERIALS: List 5-10 realistic components that would be found in this object
   - Be specific (e.g., "M4 hex bolts" not just "bolts", "6061-T6 aluminum housing" not just "metal case")
   - Include quantities where relevant (e.g., "4x M4 hex bolts", "1x motor assembly")
   - Consider structural, mechanical, and electrical components
   - Use technical terminology appropriate to the object type

3. TOOLS: List 5-8 realistic tools needed for ${mode}
   - Include both common tools (Phillips screwdriver, adjustable wrench) and specialized ones
   - Be specific about tool types (e.g., "Phillips head screwdriver #2" not just "screwdriver")
   - Consider safety equipment if relevant (safety glasses, gloves)

4. STEPS: Generate 5-8 sequential steps for ${mode}
   For each step provide THREE distinct elements:

   a) TEXT: Clear, instructional language explaining the action
      - Start with action verbs (Remove, Insert, Align, Secure, Detach, Rotate, etc.)
      - Include specific details (torque settings, alignment notes, safety warnings)
      - Write as if instructing a real person performing the task
      - Be precise about locations and orientations
      - Example: "Remove the four M4 hex bolts securing the motor housing using a 3mm Allen key. Turn counterclockwise while supporting the housing with your free hand."

   b) VIDEO PROMPT: Describe motion and action for AI video generation
      - Focus on MOVEMENT and CAMERA WORK
      - Specify the motion: "slowly rotate the housing 90 degrees counterclockwise"
      - Camera angle: "from isometric front view" or "top-down perspective"
      - Describe mechanical action: "detach the fan blade assembly by lifting upward while rotating slightly"
      - Include visual cues: "highlight the connection points with animated arrows" or "show stress points with red indicators"
      - Specify duration: "over 4-6 seconds of clear, deliberate motion"
      - Keep background minimal and educational
      - Emphasize clarity over realism
      - Example: "Camera fixed at 45-degree isometric angle. Show hands removing four bolts in sequence, with each bolt location highlighted. As the last bolt is removed, the housing separates from the base in slow motion (4 seconds total)."

   c) DIAGRAM PROMPT: Describe a static technical illustration
      - Use technical drawing terms: "exploded view", "cross-section", "isometric projection", "cutaway view", "assembly diagram"
      - Specify what to show: "the internal gear mechanism with component labels" or "the electrical connection pathway"
      - Indicate annotations: "arrows showing rotation direction", "callouts for key components", "measurement indicators"
      - Request style: "clean technical drawing style on white background" or "blueprint-style illustration with blue lines"
      - Specify detail level: "show internal components separated by 2cm spacing" or "highlight the locking mechanism detail"
      - Example: "Isometric exploded view showing the motor housing separated from the base plate. Display the four bolt positions with dimension lines. Label key components: motor assembly, bearing housing, drive shaft, mounting plate. Use clean line art on pure white background."

5. DIFFICULTY: Choose realistic difficulty based on complexity
   - Beginner: Simple objects with 5-8 steps, basic tools, no specialized knowledge
   - Intermediate: Moderate complexity, 6-10 steps, some specialized tools
   - Advanced: Complex mechanisms, 8-12 steps, specialized tools and knowledge
   - Expert: Highly complex, 10+ steps, professional tools, deep technical knowledge

6. TIME: Estimate realistic time based on complexity
   - Consider setup time, actual work time, and safety checks
   - Use ranges: "45-60 minutes", "2-3 hours", "4-6 hours"
   - Account for skill level implied by difficulty

7. SUMMARY: Write 2-3 sentences explaining:
   - What the object is and its primary purpose
   - Why this ${mode} process matters (learning opportunity, repair knowledge, engineering curiosity, sustainability)
   - A hint at the engineering principles involved (mechanical advantage, electrical circuits, thermodynamics, etc.)
   - Make it engaging and educational
   - Example: "The rotary blade assembly system demonstrates fundamental principles of rotary motion and centrifugal force. Understanding its construction enables efficient maintenance and promotes sustainable repair practices. This ${mode} guide reveals the elegant engineering behind converting electrical energy into controlled airflow."

CRITICAL REQUIREMENTS:
- Return ONLY valid JSON, no additional text or explanations
- Ensure all three elements (text, videoPrompt, diagramPrompt) are detailed and distinct for each step
- Video prompts should focus on motion and camera work
- Diagram prompts should focus on static technical illustration
- Be creative but technically plausible
- Maintain consistency with the object shown in the image

OUTPUT FORMAT: Return a JSON object with this exact structure:
{
  "title": "string",
  "mode": "assembly" or "disassembly",
  "difficulty": "string",
  "time": "string",
  "materials": ["string array"],
  "tools": ["string array"],
  "summary": "string",
  "steps": [
    {
      "id": number,
      "text": "string",
      "videoPrompt": "string",
      "diagramPrompt": "string"
    }
  ]
}`;

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
                text: `Generate a detailed ${mode} blueprint for this ${objectName}. Return ONLY valid JSON following the exact schema specified in the system instructions.`
              }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    const responseText = await minimaxResponse.text();

    if (!minimaxResponse.ok) {
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

    if (!assistantMessage) {
      return new Response(
        JSON.stringify({
          error: 'No response',
          message: 'The AI did not generate a blueprint. Please try again.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the JSON blueprint
    let blueprint;
    try {
      blueprint = JSON.parse(assistantMessage);
    } catch {
      return new Response(
        JSON.stringify({
          error: 'Invalid blueprint format',
          message: 'Failed to parse blueprint data.',
          details: assistantMessage
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        blueprint: blueprint,
        usage: minimaxData.usage
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Blueprint generation error:', error);
    return new Response(
      JSON.stringify({
        error: error.message,
        message: 'An unexpected error occurred during blueprint generation.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
