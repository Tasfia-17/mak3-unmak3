interface MinimaxMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface MinimaxResponse {
  message: string;
  usage?: any;
}

export async function callMinimax(messages: MinimaxMessage[]): Promise<string> {
  try {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/minimax-chat`;
    const apiKey = import.meta.env.VITE_MINIMAX_API_KEY;

    if (!apiUrl || !apiKey) {
      throw new Error('Missing environment variables');
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        apiKey,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Minimax API call failed');
    }

    const data: MinimaxResponse = await response.json();
    
    if (!data.message) {
      throw new Error('No response from AI');
    }

    return data.message;
  } catch (error) {
    console.error('Minimax API Error:', error);
    throw error;
  }
}

export async function generateStructuredJSON(prompt: string, imageBase64?: string): Promise<any> {
  try {
    let userContent = prompt;
    
    if (imageBase64) {
      userContent = `[Image provided]\n\n${prompt}\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no explanations, just pure JSON.`;
    }

    const response = await callMinimax([
      {
        role: 'system',
        content: 'You are a precise JSON generator. Always return valid JSON without any markdown formatting or explanations. Never use ```json blocks.'
      },
      {
        role: 'user',
        content: userContent
      }
    ]);

    const cleanedResponse = response.trim().replace(/^```json\s*|\s*```$/g, '');
    
    try {
      return JSON.parse(cleanedResponse);
    } catch {
      const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Invalid JSON response');
    }
  } catch (error) {
    console.error('JSON Generation Error:', error);
    throw error;
  }
}
