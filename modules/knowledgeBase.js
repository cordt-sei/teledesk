// modules/knowledgeBase.js
import axios from 'axios';
import { Markup } from 'telegraf';
import config from '../config.js';
import createLogger from './logger.js';

const logger = createLogger('knowledgeBase');

/**
 * Get Help Center categories with article counts
 * @returns {Promise<Array>} Categories with article counts
 */
export async function getHelpCenterCategories() {
  try {
    const response = await axios.get(
      `${config.ZENDESK_API_URL}/help_center/categories.json`,
      {
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    // Get article counts for each category
    const categories = response.data.categories;
    const enhancedCategories = [];
    
    for (const category of categories) {
      // Get sections in this category
      const sectionsResponse = await axios.get(
        `${config.ZENDESK_API_URL}/help_center/categories/${category.id}/sections.json`,
        {
          auth: {
            username: `${config.ZENDESK_EMAIL}/token`,
            password: config.ZENDESK_API_TOKEN
          }
        }
      );
      
      let totalArticles = 0;
      
      // Count articles in each section
      for (const section of sectionsResponse.data.sections) {
        const articlesResponse = await axios.get(
          `${config.ZENDESK_API_URL}/help_center/sections/${section.id}/articles.json`,
          {
            auth: {
              username: `${config.ZENDESK_EMAIL}/token`,
              password: config.ZENDESK_API_TOKEN
            }
          }
        );
        
        totalArticles += articlesResponse.data.articles.length;
      }
      
      enhancedCategories.push({
        ...category,
        articleCount: totalArticles,
        sectionCount: sectionsResponse.data.sections.length
      });
    }
    
    return enhancedCategories;
  } catch (error) {
    logger.error('Error fetching Help Center categories:', error);
    return [];
  }
}

/**
 * Get sections within a category
 * @param {number} categoryId - Category ID
 * @returns {Promise<Array>} Sections in the category
 */
export async function getCategorySections(categoryId) {
  try {
    const response = await axios.get(
      `${config.ZENDESK_API_URL}/help_center/categories/${categoryId}/sections.json`,
      {
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    // Get article counts for each section
    const sections = response.data.sections;
    const enhancedSections = [];
    
    for (const section of sections) {
      const articlesResponse = await axios.get(
        `${config.ZENDESK_API_URL}/help_center/sections/${section.id}/articles.json`,
        {
          auth: {
            username: `${config.ZENDESK_EMAIL}/token`,
            password: config.ZENDESK_API_TOKEN
          }
        }
      );
      
      enhancedSections.push({
        ...section,
        articleCount: articlesResponse.data.articles.length
      });
    }
    
    return enhancedSections;
  } catch (error) {
    logger.error(`Error fetching sections for category ${categoryId}:`, error);
    return [];
  }
}

/**
 * Get articles within a section
 * @param {number} sectionId - Section ID
 * @param {string} sortBy - Sort field (created_at, updated_at, title, position)
 * @param {string} sortOrder - Sort direction (asc, desc)
 * @returns {Promise<Array>} Articles in the section
 */
export async function getSectionArticles(sectionId, sortBy = 'position', sortOrder = 'asc') {
  try {
    const response = await axios.get(
      `${config.ZENDESK_API_URL}/help_center/sections/${sectionId}/articles.json`,
      {
        params: {
          sort_by: sortBy,
          sort_order: sortOrder
        },
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    return response.data.articles;
  } catch (error) {
    logger.error(`Error fetching articles for section ${sectionId}:`, error);
    return [];
  }
}

/**
 * Get the most viewed articles
 * @param {number} limit - Number of articles to return
 * @returns {Promise<Array>} Most viewed articles
 */
export async function getMostViewedArticles(limit = 5) {
  try {
    // Unfortunately, the Help Center API doesn't directly provide this.
    // We'd need to use the Zendesk Reporting API, but as a workaround,
    // we'll search for featured articles or most recently updated articles
    
    const response = await axios.get(
      `${config.ZENDESK_API_URL}/help_center/articles.json`,
      {
        params: {
          sort_by: 'updated_at',
          sort_order: 'desc',
          per_page: limit
        },
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    return response.data.articles;
  } catch (error) {
    logger.error('Error fetching most viewed articles:', error);
    return [];
  }
}

/**
 * Get article details
 * @param {number} articleId - Article ID
 * @returns {Promise<Object>} Article details
 */
export async function getArticleDetails(articleId) {
  try {
    const response = await axios.get(
      `${config.ZENDESK_API_URL}/help_center/articles/${articleId}.json`,
      {
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    return response.data.article;
  } catch (error) {
    logger.error(`Error fetching article ${articleId}:`, error);
    return null;
  }
}

/**
 * Advanced search for articles
 * @param {string} query - Search query
 * @param {string} label - Optional label filter
 * @param {string} sortBy - Sort field (created_at, updated_at, title, position)
 * @returns {Promise<Array>} Search results
 */
export async function searchHelpCenter(query, label = null, sortBy = 'relevance') {
  try {
    let searchQuery = query;
    
    // Add label filter if provided
    if (label) {
      searchQuery = `${searchQuery} label:"${label}"`;
    }
    
    const response = await axios.get(
      `${config.ZENDESK_API_URL}/help_center/articles/search.json`,
      {
        params: {
          query: searchQuery,
          sort_by: sortBy
        },
        auth: {
          username: `${config.ZENDESK_EMAIL}/token`,
          password: config.ZENDESK_API_TOKEN
        }
      }
    );
    
    return response.data.results;
  } catch (error) {
    logger.error('Error searching Help Center:', error);
    return [];
  }
}

/**
 * Format article summary for Telegram
 * @param {Object} article - Article object
 * @returns {string} Formatted article summary
 */
export function formatArticleSummary(article) {
  // Strip HTML tags
  const bodyPreview = article.body ? 
    article.body.replace(/<[^>]*>?/gm, '').substring(0, 100) + '...' :
    'No preview available';
    
  return `*${article.title}*\n${bodyPreview}\n\n[Read Article](${article.html_url})`;
}

/**
 * Generate Telegram keyboard for articles browsing
 * @param {Array} items - Items to include in the keyboard
 * @param {string} type - Type of items (categories, sections, articles)
 * @param {Object} pageInfo - Pagination information
 * @returns {Object} Inline keyboard markup
 */
export function generateBrowsingKeyboard(items, type, pageInfo = { page: 1, totalPages: 1 }) {
  const keyboard = [];
  
  // Item buttons
  items.forEach((item, index) => {
    let buttonText = '';
    let callbackData = '';
    
    if (type === 'categories') {
      buttonText = `📚 ${item.name} (${item.articleCount || 0})`;
      callbackData = `kb_category_${item.id}`;
    } else if (type === 'sections') {
      buttonText = `📂 ${item.name} (${item.articleCount || 0})`;
      callbackData = `kb_section_${item.id}`;
    } else if (type === 'articles') {
      buttonText = `📄 ${item.title.substring(0, 25)}${item.title.length > 25 ? '...' : ''}`;
      callbackData = `kb_article_${item.id}`;
    }
    
    keyboard.push([Markup.button.callback(buttonText, callbackData)]);
  });
  
  // Navigation buttons
  const navigationRow = [];
  
  if (pageInfo.page > 1) {
    navigationRow.push(Markup.button.callback('⬅️ Previous', `kb_prev_${type}_${pageInfo.page - 1}`));
  }
  
  if (pageInfo.page < pageInfo.totalPages) {
    navigationRow.push(Markup.button.callback('➡️ Next', `kb_next_${type}_${pageInfo.page + 1}`));
  }
  
  if (navigationRow.length > 0) {
    keyboard.push(navigationRow);
  }
  
  // Back and search buttons
  const controlRow = [];
  
  if (type === 'categories') {
    controlRow.push(Markup.button.callback('🔍 Search KB', 'kb_search'));
  } else if (type === 'sections') {
    controlRow.push(Markup.button.callback('⬅️ Back to Categories', 'kb_categories'));
  } else if (type === 'articles') {
    controlRow.push(Markup.button.callback('⬅️ Back to Sections', `kb_back_to_sections`));
  }
  
  controlRow.push(Markup.button.callback('📚 KB Home', 'kb_categories'));
  keyboard.push(controlRow);
  
  // Main menu button
  keyboard.push([Markup.button.callback('« Back to Main Menu', 'main_menu')]);
  
  return Markup.inlineKeyboard(keyboard);
}