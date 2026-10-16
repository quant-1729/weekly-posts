"use client";

import { useState } from "react";
import { cardClass, errorClass, hintClass, iconButton, inputClass, labelClass, quietButton, segButton, segTrack, strongButton } from "@/components/ui";
import type { ReviewPost } from "@/lib/create";
import { fill, s } from "@/lib/i18n/strings";

const t = s.create.review;

/**
 * Caption and hashtags of the review step, one channel at a time (a segmented control when the brief has more than one).
 * A small pencil button turns the text into fields; Save goes through the same save-and-check path as every edit of the
 * words, so the guardrail runs again and the post needs approving again. `onSave` returns an error sentence or null.
 */
export function ReviewCaptions({
  posts,
  channel,
  editing,
  busy,
  onChannel,
  onEditing,
  onSave,
}: {
  posts: ReviewPost[];
  channel: string;
  editing: boolean;
  busy: boolean;
  onChannel: (channel: string) => void;
  onEditing: (on: boolean) => void;
  onSave: (channel: string, caption: string, hashtags: string) => Promise<string | null>;
}) {
  const post = posts.find((p) => p.channel === channel) ?? posts[0];
  if (!post) return null;
  return (
    <section className={`min-w-0 space-y-3 ${cardClass}`} aria-label={t.captionsTitle} data-captions>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-card-title text-title">{t.captionsTitle}</h2>
        {posts.length > 1 ? (
          <div className={segTrack} role="group" aria-label={t.channelsLabel} data-channel-switch>
            {posts.map((p) => (
              <button
                key={p.id}
                type="button"
                className={segButton(p.channel === post.channel)}
                aria-pressed={p.channel === post.channel}
                disabled={editing}
                data-channel-option={p.channel}
                onClick={() => onChannel(p.channel)}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {editing ? (
        <CaptionEditor key={post.id} post={post} busy={busy} onCancel={() => onEditing(false)} onSave={onSave} />
      ) : (
        <div className="flex items-start gap-2" data-caption-view data-caption-channel={post.channel}>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="whitespace-pre-line break-words text-[14px] leading-[22px] text-ink" data-caption>
              {post.caption}
            </p>
            {post.hashtags.length > 0 ? (
              <p className="break-words text-[13px] leading-[18px] text-desc" data-hashtags>
                {post.hashtags.join(" ")}
              </p>
            ) : post.hashtagsMax > 0 ? (
              <p className="text-[13px] leading-[18px] text-helper">{t.noHashtags}</p>
            ) : null}
          </div>
          <button type="button" className={iconButton} aria-label={t.editCaption} data-edit-caption disabled={busy || post.status === "posted"} onClick={() => onEditing(true)}>
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 20h4L19 9a2.83 2.83 0 00-4-4L4 16v4z" />
              <path d="M13.5 6.5l4 4" />
            </svg>
          </button>
        </div>
      )}
    </section>
  );
}

/** The editable fields. Exported for tests (the edit toggle renders it). */
export function CaptionEditor({
  post,
  busy,
  onCancel,
  onSave,
}: {
  post: ReviewPost;
  busy: boolean;
  onCancel: () => void;
  onSave: (channel: string, caption: string, hashtags: string) => Promise<string | null>;
}) {
  const [caption, setCaption] = useState(post.caption);
  const [tags, setTags] = useState(post.hashtags.join(" "));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = `caption-${post.id}`;

  async function save() {
    setSaving(true);
    setError(null);
    const problem = await onSave(post.channel, caption, tags);
    setSaving(false);
    if (problem) setError(problem);
  }

  return (
    <form
      className="space-y-3"
      data-caption-form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div>
        <label htmlFor={id} className={labelClass}>
          {t.captionLabel}
        </label>
        <textarea id={id} className={`${inputClass} min-h-32`} rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} disabled={saving} data-caption-input />
        <p className="mt-1 text-note text-desc">
          {`${[...caption].length}/${post.captionMax}`}
        </p>
      </div>
      {post.hashtagsMax > 0 ? (
        <div>
          <label htmlFor={`${id}-tags`} className={labelClass}>
            {t.hashtagsLabel}
          </label>
          <input id={`${id}-tags`} type="text" className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} disabled={saving} aria-describedby={`${id}-tags-hint`} data-hashtags-input />
          <p id={`${id}-tags-hint`} className={`${hintClass} !mb-0 mt-1`}>
            {fill(t.hashtagsHint, { max: post.hashtagsMax })}
          </p>
        </div>
      ) : (
        <p className={`${hintClass} !mb-0`}>{fill(t.noHashtagsChannel, { channel: post.label })}</p>
      )}
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={strongButton} disabled={busy || saving || !caption.trim()}>
          {saving ? t.saving : t.save}
        </button>
        <button type="button" className={quietButton} disabled={saving} onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
    </form>
  );
}
