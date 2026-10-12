export class Cleaner {
  static CODEX_INJECTION_PATTERNS = [
    /<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi,
    /<environment_context>[\s\S]*?<\/environment_context>/gi,
    /<skills_instructions>[\s\S]*?<\/skills_instructions>/gi,
    /<permissions instructions>[\s\S]*?<\/permissions instructions>/gi,
    /<collaboration_mode>[\s\S]*?<\/collaboration_mode>/gi,
    /<app-context>[\s\S]*?<\/app-context>/gi,
    /<recommended_plugins>[\s\S]*?<\/recommended_plugins>/gi,
    /<apps_instructions>[\s\S]*?<\/apps_instructions>/gi,
    /<codex_apps_client_time_context>[\s\S]*?<\/codex_apps_client_time_context>/gi,
    /<external_codex_apps_open_page>[\s\S]*?<\/external_codex_apps_open_page>/gi,
    /<codex_apps_open_page_instructions>[\s\S]*?<\/codex_apps_open_page_instructions>/gi,
    /<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/gi,
    /# AGENTS\.md instructions[\s\S]*?(?=(?:\r?\n){2,}|$)/gi
  ];

  static WORKBUDDY_INJECTION_PATTERNS = [
    /<system-reminder[\s\S]*?<\/system-reminder>/gi
  ];

  static cleanUserMessage(rawText) {
    if (!rawText) return '';
    let cleaned = rawText;

    for (const pat of this.CODEX_INJECTION_PATTERNS) {
      cleaned = cleaned.replace(pat, '');
    }

    for (const pat of this.WORKBUDDY_INJECTION_PATTERNS) {
      cleaned = cleaned.replace(pat, '');
    }

    const userQueryMatch = cleaned.match(/<user_query>([\s\S]*?)<\/user_query>/i);
    if (userQueryMatch) {
      cleaned = userQueryMatch[1];
    }

    return cleaned.trim();
  }
}

