"""
infrastructure/database/models/__init__.py
==========================================
Re-exports every ORM model and Base from the domain-specific sub-modules.
Import from here for clean consumers; import from sub-modules for domain clarity.
"""

from .base import Base, DB_AVAILABLE

from .utility import (
    ScrapeRun,
    TaskHistory,
    ScraperKeyword,
    ScraperKeywordSelection,
    FacebookGroup,
    SmartBrainAnalysis,
)

from .spending import (
    ApiSpending,
    UserBudget,
    BudgetAlertEmail,
    ScraperBudget,
    ScraperCostConfig,
)

from .llm import (
    LLMAnalysis,
    LLMProviderConfig,
    LLMSpending,
)

from .newsletter import (
    NewsletterJob,
    GeneratedNewsletter,
)

from .platform_data import (
    RedditPost,
    RedditComment,
    TikTokPost,
    TikTokComment,
    EduGeekPost,
    EduGeekReply,
    AutodeskPost,
    AutodeskReply,
    StackExchangeQuestion,
    StackExchangeAnswer,
    StackExchangeQuestionComment,
    StackExchangeAnswerComment,
    GoogleNewsArticle,
    InstagramPost,
    InstagramComment,
    FacebookPost,
    FacebookComment,
    SpiceworksPost,
    QuoraQuestion,
    QuoraAnswer,
    TwitterTweet,
)

__all__ = [
    "Base", "DB_AVAILABLE",
    # utility
    "ScrapeRun", "TaskHistory", "ScraperKeyword", "ScraperKeywordSelection",
    "FacebookGroup", "SmartBrainAnalysis",
    # spending
    "ApiSpending", "UserBudget", "BudgetAlertEmail", "ScraperBudget", "ScraperCostConfig",
    # llm
    "LLMAnalysis", "LLMProviderConfig", "LLMSpending",
    # newsletter
    "NewsletterJob", "GeneratedNewsletter",
    # platform data
    "RedditPost", "RedditComment",
    "TikTokPost", "TikTokComment",
    "EduGeekPost", "EduGeekReply",
    "AutodeskPost", "AutodeskReply",
    "StackExchangeQuestion", "StackExchangeAnswer",
    "StackExchangeQuestionComment", "StackExchangeAnswerComment",
    "GoogleNewsArticle",
    "InstagramPost", "InstagramComment",
    "FacebookPost", "FacebookComment",
    "SpiceworksPost",
    "QuoraQuestion", "QuoraAnswer",
    "TwitterTweet",
]
