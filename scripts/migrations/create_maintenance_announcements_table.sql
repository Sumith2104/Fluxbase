-- ==============================================================================
-- Fluxbase Global Maintenance & System Announcements Table
-- Allows direct insertion and updating of dynamic in-app notification banners.
-- Features: Custom background color, badge text, automated end-time expiration,
-- scheduling, link buttons, priority ordering, and manual active toggle.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS fluxbase_global.maintenance_announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    badge_text VARCHAR(50) DEFAULT 'Maintenance',
    bg_color VARCHAR(50) DEFAULT '#dc2626',
    text_color VARCHAR(50) DEFAULT '#ffffff',
    badge_color VARCHAR(50) DEFAULT '#991b1b',
    start_time TIMESTAMPTZ DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    dismissible BOOLEAN DEFAULT TRUE,
    link_url TEXT,
    link_text VARCHAR(100),
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fast query index for active and scheduled announcements
CREATE INDEX IF NOT EXISTS idx_maintenance_announcements_active 
ON fluxbase_global.maintenance_announcements (is_active, start_time, end_time, priority DESC);

-- Alias view so querying 'maintenance_updates' also works seamlessly
CREATE OR REPLACE VIEW fluxbase_global.maintenance_updates AS
SELECT * FROM fluxbase_global.maintenance_announcements;

-- Seed default maintenance notice if table is empty
INSERT INTO fluxbase_global.maintenance_announcements (
    content,
    badge_text,
    bg_color,
    text_color,
    badge_color,
    start_time,
    end_time,
    is_active,
    dismissible,
    priority
) 
SELECT 
    'App is under maintenance. Some features may not work, but you can still use as normal.',
    'Maintenance',
    '#dc2626',
    '#ffffff',
    '#b91c1c',
    NOW(),
    NOW() + INTERVAL '7 days',
    TRUE,
    TRUE,
    10
WHERE NOT EXISTS (
    SELECT 1 FROM fluxbase_global.maintenance_announcements
);
