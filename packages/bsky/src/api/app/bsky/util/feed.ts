import { AtUri } from '@atproto/uri'
import { TimeCidKeyset } from '../../../../db/pagination'
import { FeedViewPost } from '../../../../lexicon/types/app/bsky/feed/defs'
import { FeedService } from '../../../../services/feed'
import { FeedRow } from '../../../../services/types'
import { LabelService } from '../../../../services/label'

// Present post and repost results into FeedViewPosts
// Including links to embedded media
export const composeFeed = async (
  feedService: FeedService,
  labelService: LabelService,
  rows: FeedRow[],
  viewer: string | null,
): Promise<FeedViewPost[]> => {
  const actorDids = new Set<string>()
  const postUris = new Set<string>()
  for (const row of rows) {
    actorDids.add(row.originatorDid)
    actorDids.add(row.postAuthorDid)
    postUris.add(row.postUri)
    if (row.replyParent) {
      postUris.add(row.replyParent)
      actorDids.add(new AtUri(row.replyParent).host)
    }
    if (row.replyRoot) {
      postUris.add(row.replyRoot)
      actorDids.add(new AtUri(row.replyRoot).host)
    }
  }
  const [actors, posts, embeds, labels] = await Promise.all([
    feedService.getActorViews(Array.from(actorDids), viewer, {
      skipLabels: true,
    }),
    feedService.getPostViews(Array.from(postUris), viewer),
    feedService.embedsForPosts(Array.from(postUris), viewer),
    labelService.getLabelsForSubjects([...postUris, ...actorDids]),
  ])

  const feed: FeedViewPost[] = []
  for (const row of rows) {
    const post = feedService.formatPostView(
      row.postUri,
      actors,
      posts,
      embeds,
      labels,
    )
    const originator = actors[row.originatorDid]
    if (post && originator) {
      let reasonType: string | undefined
      if (row.type === 'repost') {
        reasonType = 'app.bsky.feed.defs#reasonRepost'
      }
      const replyParent = row.replyParent
        ? feedService.formatPostView(
            row.replyParent,
            actors,
            posts,
            embeds,
            labels,
          )
        : undefined
      const replyRoot = row.replyRoot
        ? feedService.formatPostView(
            row.replyRoot,
            actors,
            posts,
            embeds,
            labels,
          )
        : undefined

      feed.push({
        post,
        reason: reasonType
          ? {
              $type: reasonType,
              by: actors[row.originatorDid],
              indexedAt: row.sortAt,
            }
          : undefined,
        reply:
          replyRoot && replyParent // @TODO consider supporting #postNotFound here
            ? {
                root: replyRoot,
                parent: replyParent,
              }
            : undefined,
      })
    }
  }
  return feed
}

export enum FeedAlgorithm {
  ReverseChronological = 'reverse-chronological',
}

export class FeedKeyset extends TimeCidKeyset<FeedRow> {
  labelResult(result: FeedRow) {
    return { primary: result.sortAt, secondary: result.cid }
  }
}

// For users with sparse feeds, avoid scanning more than one week for a single page
export const getFeedDateThreshold = (from: string | undefined, days = 7) => {
  const timelineDateThreshold = from ? new Date(from) : new Date()
  timelineDateThreshold.setDate(timelineDateThreshold.getDate() - days)
  return timelineDateThreshold.toISOString()
}
