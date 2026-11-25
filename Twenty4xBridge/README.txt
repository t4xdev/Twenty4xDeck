Twenty4x Bridge: deployable site

Upload everything in this folder to the web root of https://deck.twenty4x.net.

Pages
  /                      Interactive 3D deck (home)
  /solutions/            All solutions (static, crawlable)
  /products/<name>/      14 product pages (static, crawlable)
  /404.html              Not-found page

SEO files: sitemap.xml, robots.txt, site.webmanifest, favicons, social images in img/og/.
Hosting: _headers (Netlify/Cloudflare Pages) and .htaccess (Apache) set caching, compression and the 404 page.

If the domain changes, edit SITE at the top of seo.py and rebuild, or find/replace "https://deck.twenty4x.net".
After going live: submit https://deck.twenty4x.net/sitemap.xml in Google Search Console and Bing Webmaster Tools.
