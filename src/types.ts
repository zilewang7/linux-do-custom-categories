export interface Topic {
  id: number;
  title: string;
  fancy_title?: string;
  slug: string;
  bumped_at: string;
  last_posted_at?: string;
  created_at?: string;
  views: number;
  reply_count: number;
  posts_count?: number;
  highest_post_number?: number;
  like_count?: number;
  category_id: number;
  posters: TopicPoster[];
  pinned?: boolean;
  pinned_globally?: boolean;
  unseen?: boolean;
  excerpt?: string | null;
  tags?: string[];
  tags_descriptions?: Record<string, string>;
  image_url?: string | null;
  thumbnails?: TopicThumbnail[] | null;
  has_summary?: boolean;
  can_have_answer?: boolean;
  has_accepted_answer?: boolean;
  closed?: boolean;
  archived?: boolean;
}

export interface User {
  id: number;
  username: string;
  name?: string | null;
  avatar_template: string;
  flair_name?: string | null;
  flair_url?: string | null;
  flair_bg_color?: string | null;
  flair_color?: string | null;
  flair_group_id?: number | null;
  trust_level?: number;
  animated_avatar?: string | null;
}

export interface TopicPoster {
  user_id: number;
  description?: string | null;
  extras?: string | null;
  primary_group_id?: number | null;
  flair_group_id?: number | null;
}

export interface TopicThumbnail {
  width: number;
  height: number;
  url: string;
  max_width?: number | null;
  max_height?: number | null;
}

export interface CategoryInfo {
  id: number;
  name: string;
  slug: string;
  color?: string | null;
  text_color?: string | null;
  style_type?: string | null;
  icon?: string | null;
  emoji?: string | null;
  parent_category_id?: number | null;
  read_restricted?: boolean;
  description?: string | null;
  description_text?: string | null;
}

export interface CategoryResponse {
  topic_list: {
    topics: Topic[];
    more_topics_url?: string;
  };
  users: User[];
  category?: CategoryInfo;
  category_list?: {
    categories: CategoryInfo[];
  };
}

export interface CategoryGroup {
  id: string;
  name: string;
  categoryIds: number[];
}

export interface MergedTopicData {
  topics: Topic[];
  users: Map<number, User>;
  hasMore: boolean;
  pageOffsets: Map<number, number>;
  categories: Map<number, CategoryInfo>;
}

export interface CategoryMetadataCache {
  updatedAt: number;
  categories: CategoryInfo[];
}

export interface TagIconEntry {
  tag: string;
  icon: string;
  color?: string | null;
}

export interface TagIconCache {
  updatedAt: number;
  entries: TagIconEntry[];
}
