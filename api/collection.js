const DISCOGS_USERNAME = "Eiliv";
const CACHE_SECONDS = 3600;

module.exports = async function handler(request, response) {
  try {
    if (!process.env.DISCOGS_TOKEN) {
      return response.status(500).json({
        error: "DISCOGS_TOKEN is missing",
      });
    }

    const collection = await fetchCollection(process.env.DISCOGS_TOKEN);

    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader(
      "Cache-Control",
      `s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`
    );

    return response.status(200).json({
      username: DISCOGS_USERNAME,
      updated_at: new Date().toISOString(),
      count: collection.length,
      collection,
    });
  } catch (error) {
    return response.status(500).json({
      error: "Could not retrieve the Discogs collection",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

async function fetchCollection(token) {
  const perPage = 100;

  const headers = {
    "User-Agent": "EilivVinylCollection/1.0",
    Authorization: `Discogs token=${token}`,
    Accept: "application/json",
  };

  const firstData = await fetchPage(1, perPage, headers);
  const totalPages = firstData.pagination?.pages ?? 1;

  let releases = firstData.releases ?? [];

  for (let page = 2; page <= totalPages; page++) {
    await sleep(500);

    const data = await fetchPage(page, perPage, headers);
    releases = releases.concat(data.releases ?? []);
  }

  return releases
    .map((item) => {
      const info = item.basic_information ?? {};

      return {
        instance_id: item.instance_id ?? null,
        release_id: info.id ?? null,
        master_id: info.master_id || null,
        artist: (info.artists ?? [])
          .map((artist) => artist.name)
          .join(", "),
        title: info.title ?? "",
        year: info.year || null,
        labels: (info.labels ?? []).map((label) => ({
          name: label.name,
          catalog_number: label.catno,
        })),
        formats: (info.formats ?? []).map((format) => ({
          name: format.name,
          quantity: format.qty,
          descriptions: format.descriptions ?? [],
        })),
        date_added: item.date_added ?? null,
        discogs_url: info.id
          ? `https://www.discogs.com/release/${info.id}`
          : null,
      };
    })
    .sort((a, b) => {
      const artistComparison = a.artist.localeCompare(b.artist);
      return artistComparison || a.title.localeCompare(b.title);
    });
}

async function fetchPage(page, perPage, headers) {
  const url =
    `https://api.discogs.com/users/${encodeURIComponent(
      DISCOGS_USERNAME
    )}/collection/folders/0/releases` +
    `?page=${page}&per_page=${perPage}`;

  const result = await fetch(url, { headers });

  if (!result.ok) {
    const remaining = result.headers.get(
      "X-Discogs-Ratelimit-Remaining"
    );
    const retryAfter = result.headers.get("Retry-After");

    throw new Error(
      `Discogs API error ${result.status}` +
        (remaining !== null
          ? `; rate-limit remaining ${remaining}`
          : "") +
        (retryAfter
          ? `; retry after ${retryAfter} seconds`
          : "")
    );
  }

  return result.json();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
