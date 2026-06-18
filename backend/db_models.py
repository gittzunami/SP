"""
db_models.py — Backward-compatibility shim
==========================================
All ORM models have moved to infrastructure/database/models/.
This file re-exports everything so existing imports keep working
without any changes to services/, llm_service.py, newsletter_service.py, etc.

New code should import directly from the domain-specific modules:
  from infrastructure.database.models.spending import ApiSpending
  from infrastructure.database.models.platform_data import RedditPost
  from infrastructure.database.models import Base, ScrapeRun   # flat re-export
"""

from infrastructure.database.models import (  # noqa: F401
    Base,
    DB_AVAILABLE,
    # utility
    ScrapeRun,
    TaskHistory,
    ScraperKeyword,
    ScraperKeywordSelection,
    FacebookGroup,
    SmartBrainAnalysis,
    # spending
    ApiSpending,
    UserBudget,
    BudgetAlertEmail,
    ScraperBudget,
    ScraperCostConfig,
    # llm
    LLMAnalysis,
    LLMProviderConfig,
    LLMSpending,
    # newsletter
    NewsletterJob,
    GeneratedNewsletter,
    # platform data
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

# Legacy alias used in database.py
_DB_AVAILABLE = DB_AVAILABLE
