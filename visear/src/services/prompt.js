const { OpenAI } = require('openai');
const Store = require('electron-store');

async function enhancePrompt(prompt, apiKey) {
    if (!prompt || !prompt.trim() || !apiKey) {
        return { success: false, error: 'Missing prompt or API key' };
    }

    try {
        const openai = new OpenAI({
            apiKey: apiKey
        });

        const defaultSystemPrompt = 'You are an assistant that helps improve image search queries. Make the query more descriptive and specific for visual search. Respond only with the improved query text, nothing else. Your response can be anywhere from 10-14 words, but should not exceed 14 words. Do not include quotes in your response. Here is an example image description: "A green field with a hill and blue sky with white clouds. The hill is in the foreground and the sky is in the background. The sky is blue and the hill is green.". Return a query that is formatting like a list of tags.';
        
        const store = new Store();
        const systemPrompt = store.get('openai.systemPrompt') || defaultSystemPrompt;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: `Improve this image search query: "${prompt}"`
                }
            ],
            temperature: 0.5,
            max_tokens: 64
        });

        const enhancedPrompt = completion.choices[0].message.content.trim();
        return { success: true, enhancedPrompt };
    } catch (error) {
        return { 
            success: false, 
            error: error.message || 'Failed to enhance prompt'
        };
    }
}

module.exports = { enhancePrompt };
