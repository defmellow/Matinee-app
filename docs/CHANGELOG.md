# Matinee changelog (main)

Newest first. Plain language; what you'd notice.
The TOP section is published as the release notes (and shown in Settings → Updates) by the next build. After a build, retitle it with its version and date, then start a new "## Next build" section above it.

## v1.0 — 24 Nov 2026
- **Matinee 1.0, the first public release.** Download it from github.com/defmellow/matinee-app/releases.
- **Updates without a key.** Matinee now checks the public releases page, so Settings → Updates no longer asks for a GitHub key, and the old key is removed. Copies from before 1.0 won't find this version by themselves: download it once and install it over the old one. Your library stays as it is.
- **Guide removed from Settings.** The one thing kept from it, Show onboarding again, now sits in Settings → Letterboxd, under Your Letterboxd.
- **Settings → Debug is tidier.** It shows only the Debug mode switch until you turn it on; then Share data, Problems, the fetch log, Test fetch and the rest appear. The red dot on Settings for new problems also shows only in Debug mode.
- **Share data** is now simply called Share data. Its file is matinee-share.zip, and your file manager now opens on it once it's made (that step never worked before).
- **Plainer download names.** Each file now says what it's for: Matinee-1.0.0-Windows.exe (or -Windows-Portable.exe), Matinee-1.0.0-Mac.dmg (Apple Silicon Macs) or -Mac-Intel.dmg, and Matinee-1.0.0-Linux.AppImage or -Linux.deb.
- **Mac Dock icon.** Matinee's icon now sits the same size as other apps in the Dock, instead of filling the whole square.
- **Linux taskbar icon.** Matinee's window now matches its menu entry, so the taskbar and app switcher show Matinee's icon instead of a blank one.
- **Linux update fixes.** If an AppImage update fails to install, the Download button now opens the AppImage instead of the Windows installer, and the storage figures count the AppImage's update downloads.
- **Map on a Mac trackpad.** Two fingers move around the Map and a pinch zooms it, as in Maps (⌘ and the mouse wheel zoom too). Before, scrolling zoomed and a pinch zoomed the whole app.
- **Mac wording.** The zoom tip says ⌘ on a Mac instead of Ctrl.
- **Mouse side buttons on a Mac.** The back and forward buttons on a mouse now go back and forward, and so does a three-finger swipe when the trackpad is set to swipe between pages.
- **The export as a folder.** Safari on a Mac unzips downloads by itself, so the Letterboxd export can turn up as a folder. Matinee now takes the folder too: drag it in, or click and choose it.

## v0.57 — 24 Nov 2026
- **Mac and Linux.** Matinee now also comes for Mac (a .dmg for Apple Silicon and one for Intel Macs) and Linux (an AppImage and a .deb). The Mac app isn't signed by Apple, so the first time you open it, right-click Matinee and choose Open, or go to System Settings → Privacy & Security and choose Open Anyway. If your Mac says the app is "damaged", open Terminal and run `xattr -cr /Applications/Matinee.app`, then open it again. Mac copies can't update themselves: when a new version is out you'll see "Update available" with a Download button, which opens the right file for your Mac. On Linux, the AppImage updates itself (make it executable first: `chmod +x Matinee-*.AppImage`); the .deb can't, so download the new .deb when "Update available" appears and install it over the old one.
- **No "What's new" on a brand-new install.** Someone opening Matinee for the first time no longer gets the whole changelog right after the welcome steps.

## v0.54 — 24 Nov 2026
- **A welcome for new people.** First open now walks through importing your Letterboxd export, then three optional steps while your films fill in: your look (theme, feel colours, less motion), about you (country, Letterboxd username, free API keys, friend code) and a quick look around in seven cards. Skip at any point; it only shows when there's no library yet.
- **Bring your library to another computer.** "Not your first time?" on the first screen restores a backup from Settings → Your data.
- **Country.** Settings → Letterboxd has a Country: Upcoming and age ratings follow it.
- **Friend code.** Settings → Letterboxd → "Have a friend code?" turns on the Dendy Newtown tab in Upcoming. Without a code there is no Dendy tab. Your own library keeps it.
- **Guide.** Settings → Guide lists ways to use Matinee, the colour key and the welcome tour again; "Show me" takes you there and rings where to start.
- **Start over keeps your choices.** Your look, country, username, friend code and keys stay; only your films, ratings, diary, tags and notes are cleared.
- **Go back to onboarding.** Settings → Debug can open the welcome steps again without touching your library.
- **Plainer wording.** A few phrases read like stock app copy and are now said plainly: Insights says "Feelings you rate lower" and "Your ratings have stayed about the same", the Map says "Other feelings nearby", and the update channel is "Main (stable)".
- **Hover on a colour to see what it means.** The coloured line under a poster, the ring around a film page's poster and the coloured words in "How it feels" now name their colour when you hover on them, in the Map key's words ("Red: tense or dark"). A film with two colours lists both. Nothing new shows until you hover.
- **Feel colours switch.** Settings → Appearance can now turn the feel colours off and on.
- **The Map's lines stay put when you click.** Pointing at a film shows lines to its closest films, and clicking it now shows those same lines (before, pointing often showed one line and clicking showed eight).
- **No more stray titles around posters.** Posters that hadn't loaded yet could spill their title and year outside the picture (on the Map's film card, for one). The title now stays inside.

## v0.53 — 23 Nov 2026
- **The Library and By feel are one screen.** The Library now does both. Your films are under tabs with counts (All, Watched, Watchlist, Liked, Not rated); the search looks for titles and people; Length, Your rating and Matinee score are buttons on the top bar. "Feelings and filters" opens beside the films in three tabs (Feelings, What it's about, The film), with a find box for the tab you're on (or every tab), Jump to, Collapse all and Expand all, and Show more on long groups. One click on a chip looks for it, a second leaves it out, a third clears it. What you picked shows above the films as pills, and each card says how close it is (Very close, Close, Some overlap). "More like this" on a poster and "See more" on a film page's similar films open the same list.
- **The Map is rebuilt.** Films that feel alike are near each other, with lines to their closest matches (thicker is closer). Colours show each film's main feeling (red tense or dark, yellow warm or funny, green thrilling or fast, blue moving, thoughtful or sad, purple strange or dreamlike), and dot size shows your rating, the Letterboxd average or the Matinee score. Arrange it by how films feel or what they're about; search for a film or a feeling; click a colour in the key to pick those films out. Zoomed in, films become posters that never cover each other. Click a film to see its closest films and why, and nothing jumps when you do. Films with too little written about them are hidden unless you ask. It's under the Library in the side menu and opens straight away.
- **Feel colours across the app.** Posters carry a thin line in their film's feeling colour (a ring on the film page), the poster card is framed in it, and the feelings in a film's headline are coloured. A film torn between two feelings shows both. F8 turns the colours off for now.
- **Insights is rebuilt** as seven tabs: Overview, Ratings, Taste, People, World, Habits and Watchlist.
- **Year in review is rebuilt:** highlights, films, taste, people, a calendar and your keepsake card.
- **"Rough guess" is said up front.** When little has been written about a film, the line is right under the headline instead of in the small print.
- **Smaller changes.** The side menu marks the screen you're on with a short pink bar; switches, score boxes and diary entries respond when you point at them; search boxes get a pink ring while you type. Every page starts at the same place on a wide window.
- **"Match system"** is the theme choice that follows your computer's light or dark setting.
- **Tonight is put away for now.** It's gone from the side menu; nothing is deleted.
- **Film headlines read better.** The line under How it feels now ends "…, about war" or "…, about coming of age and adolescence" instead of "with a sense of", which didn't fit most themes.
- **Copy buttons work.** Copying the problem list, the folder path, the fetch log and the Test fetch report failed with "Couldn't copy"; Matinee now lets itself write to the clipboard.
- **One score note at a time.** On a film page, clicking a score box and then pointing at the next one showed two notes on top of each other.
- **"Update ready" in the side menu works.** Clicking it now restarts Matinee into the new version. Before, it only opened Settings, so on the Settings page it seemed to do nothing.
- **No more pauses while Matinee works out how films feel.** Opening a film, By feel and Tonight no longer stall for half a second each time a source finishes in the background, and the long first reading after an update no longer freezes the app: it now happens shortly after launch while everything else keeps responding.
- **Sort the Library by Letterboxd average.** A new choice in the sort menu, and the Letterboxd column in the list view sorts too. Films without an average go last.
- **Less motion.** A new switch in Settings → Appearance stops the app's animations, smooth scrolling and things that slide or grow, for anyone who finds movement uncomfortable. With it off, Matinee still does this by itself when your computer is set to reduce animations.
- **A new Matinee logo.** The installer, shortcut, taskbar button and the top of the side menu show a charcoal cinema ticket with a cream edge and a big M in slanted stripes of the feel colours, designed to stay readable at small sizes. It doesn't change colour with the theme.
- **Faster after a restart.** Matinee now keeps its reading of each film's reviews between launches, so the first "How it feels" or "Similar in feel" you open after starting the app is ready in about a second instead of ten.
- **No more "aftercreditsstinger".** A TMDB keyword that only says a scene follows the credits was showing up as a subject and as a reason two films are alike. It's gone.
- **"Similar in feel" comes up faster.** Matinee compares films about twice as fast, with exactly the same results.
- **Pink buttons sit flat.** The soft pink shadow under buttons like "Open film" is gone, to match the rest of the app's flat look.
- **Every row of "How it feels" stays on the page.** A row where Matinee has nothing sure to say used to vanish until you pressed Show more (Tone went missing this way on about 190 of your films). Now its faint dashed chips show straight away, and a row with nothing at all says so ("Reviews don't say enough about its mood"). Themes, Subjects, Kind of film and Set in do the same ("No setting found yet") instead of disappearing.

## v0.42 — 15 Nov 2026
- **The app icon follows your theme.** Blush shows a pink M on brown (or a deep rose M on cream in Blush light); Dark shows a blue M on grey, Light a blue M on pale grey. It changes on the taskbar and in Alt+Tab while Matinee is open. The desktop shortcut and a pinned taskbar button keep the Blush icon, because Windows reads those from the app file, not from the open window.
- **Settings: Storage is now part of Your data.** One section for everything about what Matinee keeps on this computer: backups, the data folder, Start over, and how much space it uses with Clear cache.
- **"How sure" stands out a little more.** The sentence opening the line under "How it feels" ("Matinee is very sure about this film's feel.") is now bold.
- **"How it feels" no longer drops whole rows.** One limit of 14 chips for the whole page used to cut rows on a quarter of your films (Past Lives had no Tone). Each row now shows its own strongest chips, up to six, and one **Show more** under the feelings opens everything else, up to twelve a row.
- **Dashed now means one thing: very unsure.** A dashed chip is a feeling that only one review, one keyword tag or one Letterboxd list mentions. Rest on it to see which. On a film Matinee is very sure about, these wait behind Show more. On a film with little written about it, they top a thin row up to three so the page isn't bare. Before, over half of all feeling chips looked dashed just for trailing the film's single strongest chip.
- **A chip's shade is fairer.** Darker means stronger. A chip is dark if it is strong in its own right or if it is among that film's strongest, whichever is kinder, so one heavily mentioned theme no longer fades everything beside it, and a film with few reviews isn't all pale.
- **Pace plays safe.** Matinee now reads everyday phrases ("slow paced", "well paced", "takes its time", "too long", "never a dull moment") and stops mistaking "slowly" and "slow motion" for a slow film, but it only shows Pace when reviewers clearly agree. Otherwise the row says "Reviews don't say enough about its pace" instead of disappearing.
- **Films with fewer reviews are no longer marked down for it.** A feeling said in two or more reviews is scaled by the share of reviewers saying it. Grave of the Fireflies now comes up for Moving, Alien for Terrifying, The Wizard of Oz for Wondrous.
- **By feel: asking for two things means both, and "leave out" means out.** Films with every chip you picked rank first, a film missing one is never badged "Very close", a film with only one of two reads "Some overlap", and a film that clearly has a chip you left out no longer appears at all.
- **How sure Matinee is.** The line under "How it feels" now starts with a plain sentence about the whole film, such as "Matinee is fairly sure about this film's feel". Rest on it for the reasons. In By feel results, a film with little written about it carries two quiet words: "rough guess".
- **Subjects are cleaner.** Viewer moods that keyword lists carry ("Cheerful", "Complicated", "Baffled", "Pretentious" and about fifty more) no longer show as Subjects. Nothing else in Subjects changed, and it is still unlimited behind its own Show more.
- **"Rough guess" is said up front.** When little has been written about a film, the line now sits right under the headline ("Rough guess. Little has been written about this film, so take what's below lightly.") instead of in the small print at the bottom.
- **Cast and crew portraits for films TMDB doesn't list.** A film that TMDB files as a series or doesn't have at all (jeen-yuhs: A Kanye Trilogy) takes its credits from Letterboxd, which has no portraits, so the card showed initials even for people whose own page shows a photo. The card now looks those people up the same way the person page does.
- **Clearing the Problems list now clears the badges too.** In Debug mode the sidebar went on saying "2 err 10 warn", and the dot on Settings stayed lit, after the list was emptied.
- **Fewer false "the site may have changed" notices.** Matinee raised that notice after five pages in a row with no scores. A run of small films that Rotten Tomatoes or Metacritic simply doesn't score could trip it. A score-less page now counts fully only when something else says the film has a score there.
- **Opening a film no longer re-fetches Rotten Tomatoes and Metacritic every time.** Each source used to have its own fixed "re-read after N days" for an opened film, and those two had the shortest (14 days), so nearly every film you opened fetched them again, even decades-old films whose scores no longer move. Now one timetable covers everything and goes by the film's age: a film in cinemas is checked again after 2 days when you open it, a film from the last year after about 2 weeks, an older film after about 6 weeks (scores) or 6 months (everything else). The quiet background refresh is unchanged.
- **Audience scores no longer depend on which films you've opened.** Rotten Tomatoes' audience score, Metacritic's user score and the critics' consensus line come only from those sites' own pages, and they were only read when you opened a film. They now fill in for every film, last in the queue, so nothing you see first waits on them.
- **Debug panel:** "Which source supplied what" now also lists scores and the review text used for "How it feels", so a source that only gives those no longer looks like it gives nothing.

## v0.39 — 11 Nov 2026
- **Filter by language.** Library → Filters has a Languages group (most common first, More for the rest), and a film's languages on its page open the Library filtered by them. Silent films show as **Silent** and later films without speech (like Koyaanisqatsi) as **No dialogue**. Language names are tidied, so "American English" counts as English and the Mandarin variants as Mandarin.
- **Hovering a person shows all their films in your library.** The card now has a scrolling strip of posters for every film of theirs you have watched, watchlisted or saved in any way (as long as it has its own page and a poster). Watched films show your stars, watchlist films a small clock, and you can click one to open it.
- **Films you take off your Letterboxd watchlist come off Matinee's too.** When your activity page shows a film was added and later isn't, Matinee takes it off your watchlist (your tags and notes stay with the film). If more than five would go at once, it holds off and tells you instead. Older watchlist films can't be spotted this way, so there's a small **Remove from watchlist** link on the film page (with Undo; it only changes Matinee, not Letterboxd), and a once-a-month reminder at the top of the Library to re-import. You can snooze it for 3 months or switch it off (and back on in Settings → Your data).
- **"What's new" works again on stable builds.** v0.38 showed nothing after updating; its notes are in Settings → Updates → What's new.
- **Rotten Tomatoes scores show up again.** Rotten Tomatoes changed how its pages give the scores, so new films (like The Moon) got none. Films that came back empty are read again once.
- **Out-of-date Rotten Tomatoes and Metacritic links are found again.** When the stored link leads nowhere, Matinee looks the film up by its title and year and keeps the right link.
- **In How it feels, the strongest chip comes first** in Subjects, Kind of film and Tone too; a light Letterboxd hint no longer sits in front of stronger chips.
- **Nothing fails silently any more.** Every problem anywhere in the app is recorded, flagged **Error** (something isn't working) or **Warning** (something looks off, like a niche film with no Rotten Tomatoes page). They're listed in Settings → Debug → Problems, with Copy all and Open logs folder, and saved in a `logs` folder in Matinee's app data. Nothing pops up: a small dot on Settings only appears for new errors.
- **Debug mode** (Settings → Debug): extra detail everywhere: error and warning counts in the sidebar, a Debug panel on each film page (every source's status, why it failed, where each detail came from, that film's problems), numbers on every screen, and a pop-up for each new error.
- **The film page says when a source found nothing** ("Not found on 2 sources"), and if a ratings site's pages stop giving scores (the site changed), Matinee says so.
- "Share data" now includes the logs.

## v0.38 — 10 Nov 2026
- **No more pointless hover boxes:** a hover box no longer pops up just to repeat what you can already read (like a character name in the cast list). It still shows when the text is cut off.
- **Posters pop a little when you rest on them,** the same way everywhere: Library, film pages, series, people, By feel, Tonight, Diary, Insights and Year in review.

## v0.37 — 10 Nov 2026
Everything from the experimental builds since v0.32.

**How it feels**
- **More accurate feeling chips:** feelings no longer come from the film's own title (Mad Max: Fury Road isn't "Angry"), cast or crew names, "not" sentences ("hardly chaotic"), words that mean something else ("I hope", "a score of 80") or praise of one actor ("charming performance"). A feeling needs real evidence: one passing mention in a single review no longer becomes a chip, and Letterboxd's shared word lists only hint at a feeling.
- **Letterboxd's long theme names are gone.** Each is split into short tags in the right row: "Monsters, aliens, sci-fi and the apocalypse" becomes Monsters and aliens (Subjects) and Apocalypse (Themes); "Westerns" goes to Kind of film; "Crude humor and satire" becomes the tones Bawdy and Satirical. A film only gets the parts its own reviews, articles or keywords back up; otherwise the group's main idea shows as a light hint. Saved filters with the old names still work.
- **Themes named by several sources rank higher,** and "Similar in feel" and By feel weigh a shared theme by how central it is to both films (Taxi Driver no longer pulls in John Wick 3 just for being neo-noir).
- Films with too few reviews say so, instead of showing themes with no feelings above them.

**By feel**
- The search dropdown stays (the Layout switch is gone). Long tag names aren't cut off, and picking a suggestion clears what you typed.

**People and series**
- **Person pages:** your films first, then "More of their films", newest first.
- **Films outside your library look the same everywhere** (person pages and series): marked "Letterboxd ↗", "Open on Letterboxd" when you rest on them, opening the film's own Letterboxd page where possible.
- **Series are complete and in order:** they come from TMDB first, so Mad Max shows all six films, oldest first, unreleased last.
- **Portraits fixed:** cast photos fill in for older films; the director, music and cinematography have photos, and the poster hover card shows the director's photo. Resting on a person's name starts loading their films so their page opens straight away.

**Look**
- **Appearance:** pick a theme from small previews: Blush, Blush light, Dark (plain greys) and Light (plain light greys), both with a soft blue accent, or Match Windows.
- On film pages, "Your history" is now "Watch history". The Matinee score hover says it is "a blend of multiple sources". Long titles on posters without artwork no longer break mid-word.

**Settings**
- **One page you can scroll through;** the list on the left jumps to each section.
- **Storage:** a bar shows what uses space, including Matinee itself and its built-in browser (hover a section for its size). **Clear cache** removes saved lookups, images, old logs and the browser's cache; your library, everything fetched about your films and passed site checks stay.
- **Updates are checked as soon as you open Matinee.**
- **Upcoming has two tabs:** Opening soon and Dendy Newtown. **Discover is archived** (Settings → Debug → Archived).
- **Settings → Debug** holds the troubleshooting tools; Share data makes a small zip with everything in it.
- Cast photos for your whole library: Matinee quietly re-reads each film from TMDB once in the background.

## v0.32 — 9 Nov 2026
Everything from the feel lab since v0.14 is now in the main app.

**How it feels, rebuilt**
- **A clearer headline:** feelings and the main theme, e.g. "Moving, sad and visually striking, with a sense of redemption".
- **Rows under the headline:** Mood, Tone, Pace, Craft, Emotional impact, Themes, Subjects, Kind of film and Set in. Each row is sorted strongest first and shaded darker to lighter.
- **Themes are big ideas, named like Letterboxd's:** Relationships, Family, Trauma, Guilt and so on, plus Letterboxd's own theme groups for the film. Different meanings are kept apart (Betrayal and Infidelity, Crime and Gangsters). Detection is much stricter, so idioms, titles and praise words no longer create themes.
- **Plainer feeling words:**
  - Brooding is now Moody, Farcical is Silly, Wry is Dry wit, Sardonic is Mocking, Lyrical is Poetic, Naturalistic is True to life and Cerebral is Intellectual.
  - Wistful is folded into Bittersweet; saved filters move across.
  - New moods: Mysterious, Dark, Weird, Gentle, Chaotic and Cold.
- **Pace** uses nine plain words, from Breakneck to Drags.

**By feel**
- Every chip on a film page opens By feel as a pill, and every kind of chip is in the filters.
- Type in the box to search all the tags. Long lists scroll in their own box.
- **Three layouts to try for the tag search:** Dropdown, In place and Strip. Use the small "Layout" row under the box, then tell me which one stays.

**Film page**
- **Three alternative layouts to try:** Feel first, Cinematic and Sticky poster, as well as the current one. Use the small "Layout" row at the top of a film page, then tell me which one stays.
- **People have faces:** photos beside the cast and a portrait on person pages. Photos show on a film once TMDB has re-read it.
- **Rest on a name to see who it is:** a small card with their photo, their part, how many of their films you've seen and a few posters.
- The Cast and crew card is tidier, and the poster hover card shows the director.

**People**
- **Person pages work like Letterboxd's:** a director's films as director, and every film an actor was in, with a role switcher.
- Person pages load from TMDB first, so they're quick.
- Simpler filters: All, Watched, Watchlist and Not seen, plus "Sort by".

**Faster and fresher**
- **Faster fetching:** each film moves on as soon as its own links are found, and TMDB starts straight away for new films. Posters and basics appear within a second or so, and the slower sources still fill in everything else afterwards.
- **Watchlist additions from Letterboxd are picked up** from your activity, without a new export.
- Fixed Metacritic scores for moved pages and films that share a title. The Sources bar no longer sticks at 99%, and the "Finding films for you" message goes away.

**Look and feel**
- **What's new popup:** after an update, Matinee shows what changed. Settings → Updates can show it again.
- **No grey Windows title bar:** the top of the window is the app's own colour.
- **Consistent shapes:** tags are pills, buttons and boxes have 8 px corners, small labels are flat, and text sits centred.
- **One hover box at a time:** no tooltip on top of a score's info box.
- **Settings has a section list on the left.** Your data shows how much space Matinee uses, and Sources shows one quiet line once everything is filled in.
- Year in review is a card at the top of Insights. A slim scrollbar is used everywhere.

## v0.14 — 29 Oct 2026
- **New film page layout:** a Cast and crew card sits top right (director, music and cinematography link to their pages; "Full cast and crew" expands). Below, two independent columns: How it feels and Details on the left; Awards (5, then "Show all"), Your history (4), tags and Part of series on the right. Long synopses are clamped with "Read more". Narrow windows stack the columns.
- **About chips:** the darkest (strongest) chips are now always on the left, fading to the lightest on the right.
- **Better themes:** curated "Films about…" categories (such as Anti-black racism in the United States on Sinners) are now matched against what critics and viewers write even when they use shorter wording, and one-word feel adjectives (Frightened, Playful) no longer appear as themes.

## v0.13 — 29 Oct 2026
- **Much faster fetching:** every site is now read several requests at a time instead of one (Metacritic 4, Letterboxd 3, AllMovie 4, IMDb 3, Rotten Tomatoes 3, Wikidata 3, and more). Your last Test fetch showed no site blocking or erroring, with Metacritic and the single page window as the bottleneck.
- **AllMovie and IMDb pages are read plainly first** (about 2.5 s each, many at once), and the page window is only used when a plain read gives nothing readable, so they no longer queue behind each other in one window.
- The per-site safety nets are unchanged: if a site starts turning requests away, Matinee pauses that site.

## v0.12 — 29 Oct 2026
- **Share data (Settings):** one button writes a file (your films, ratings, tags, everything fetched for each film, the feel profiles, the fetch log and the last Test fetch) to your Documents folder and shows it in Explorer, so you can attach it in the chat. Keys and passwords are never included.

## v0.11 — 29 Oct 2026
- **Feel scores for themes:** every theme under "How it feels" now has a confidence score and a reason (hover a chip). The About chips are ranked and shaded darker to lighter by how central the theme is to the film, and no theme is thrown away before ranking any more (Wikidata's main subjects such as Linguistics, Predestination and First contact now show on Arrival). Mood, tone, pace, craft and impact chips are sorted and shaded the same way; the dots are gone.
- **Wikipedia "themes":** the feel engine now reads only genuine analysis sections (Themes, Analysis, Interpretation, Symbolism), not music or style prose. Matinee re-reads each film's Wikipedia page once, quietly, to apply this.
- **Fewer slow reads:** a slow Wikidata label search was rebuilt so it no longer stalls everything else, and RT and Metacritic score pages are skipped when OMDb already has the critic score (opening a film still reads them).
- **Matinee score:** a typical range and hover note, and a histogram of the films you've watched on Insights.
- **Choose for me** is its own page with just the time slider on top; the panel stays open while you drag, and it picks again if the film no longer fits.
- **Film page:** "Where to watch" is gone. Year-in-review month chart no longer overlaps. Sort and other drop-downs have a small chevron that matches the theme. The countries map has a clear focus ring.

## v0.10 — 29 Oct 2026 (hotfix)
- **Posters:** films whose Letterboxd data was stored by an older version (no poster, summary or ids) are re-read, so the Letterboxd poster fills in. Re-read at most every 3 days.
- **Tonight:** a mix of pick categories (Safe bet always, plus two from Stretch, Been waiting, Just added, Quick one, Critics' pick, Familiar ground, Left field, Just out, A classic). Shuffle avoids films from the last few screens, and Back / Forward steps through earlier picks; "Shown earlier" lists them.
- **Tonight moods:** reworded and extended to 12 (Light and sweet, Cosy and comforting, Black comedy, Quiet and poignant, Moody and atmospheric, Something to think about, plus the earlier ones). A mood is hidden when fewer than 3 films on your watchlist match it.
- **Choose for me (Tonight):** one film with only its poster, title, year and length. "Not this one" asks why (too heavy, light, strange, bleak, silly, intense, slow, scary, or seen something like it), or which mood you're in, and the next pick moves that way. A time slider is in the same panel.
- **By feel:** using only an "exclude" now lists every film without that feeling instead of "no films".
- **Poster hover card** now works on every screen with film posters (By feel, People, Diary and more), not only Library and Tonight.
- **Look:** note and log boxes are rounded rectangles (not pills); the runtime slider has a filled track; "How it feels" chips are one size; drop-down lists match the theme; About no longer repeats countries and languages as chips; the Dendy list shows only the first date.

## v0.9 — 29 Oct 2026 (planned as 0.6; the run number made it 0.9)
- **Open a film and everything is attempted:** all sources are tried straight away and the page fills in live. If some fail, a small "Failed 2 sources" pill appears; click it to see which and why, and try again.
- **Choose your poster:** click the poster on a film page and pick from every source that has one (or leave it on Automatic). It's used everywhere in the app. Without a choice, TMDB (if you've added a key) then Letterboxd, then Wikipedia.
- **Person pages:** every director, writer and cast name opens a page with all their films (from Letterboxd, or Wikidata if Letterboxd is unavailable), with the same Watched / Watchlist / Unseen / Liked / Unrated filters as the Library plus role, decade, sort and search.
- **Dendy Newtown on Upcoming:** what's showing and what's open for booking, with each film's first date and a link to Dendy for times; films in your library show as posters. Events (NT Live, concerts, trivia) are hidden unless you ask. Checked about daily.
- **Test fetch (Settings → Sources):** fetches about 24 of your films as a trial, changes nothing, and gives a report you can copy or save: how each site behaves on this PC, which sources fill which details, and how much each source changes the "by feel" results.
- **Redundancy:** when one site is slow or blocked, the other sources keep going and fill what they can; a film is never held up by one site. With TMDB or OMDb keys, slow page reads are skipped where those already supplied the same details.
- **Refresh never blanks anything:** Refresh now updates quietly like the background pass and keeps what is stored. Re-reads are sparing (old films rarely, films in cinemas or opening soon every few days) and those films go first.
- **Time left** now shows an estimate while Matinee is fetching (the screen wasn't updating it before).
- **TMDB and OMDb:** one request per film each; OMDb stops at 900 requests a day and picks up tomorrow; OMDb awards, box office and countries are stored.
- **Themes:** dark Blush polished; the light theme now uses the same layout with a warm rose palette.
- Quiet re-reads: once everything has been fetched for the first time, Matinee re-reads pages in the background without showing progress, and a failed or empty re-read never removes what's already stored.
- Diary rows show a score; posters fade in as they load; Escape closes the Library filters; the empty Library state has one clear button.
- **New look (Blush):** soft pink on warm brown-grey, rounder pills and cards, Quicksand headings and Nunito text, no all-caps titles.
- **Everything that looks like a button is one:** genres, year, countries, languages, series, Watched/Watchlist and tags on the film page open the Library filtered by them.
- **Back and forward** buttons in the sidebar (and your mouse's side buttons), like a browser.
- **Zoom:** Ctrl + and Ctrl − (or Ctrl and the mouse wheel) zoom the app; Ctrl 0 resets. Matinee remembers the zoom.
- **Matinee score:** spread out properly so the best films stand out; a small pip on posters in the Library, Upcoming and Tonight (turn it off in the Library view options). The Letterboxd score always comes first.
- **Score hovers:** hover a score on the film page to see how that site tends to rate.
- **Loading:** a small pill at the bottom right shows when Matinee is fetching details for the films on screen; films missing a Letterboxd score are fetched first.
- **Runtime slider:** Tonight's "How long have you got?" and the Library runtime filter are sliders that go up to the longest film you have (all the way right means any length).
- **Library and By feel:** the Unwatched option is gone (it was the same as Watchlist); old saved views now show the watchlist.
- **Upcoming** has its own ticket icon (it shared Diary's calendar).
- **Your own tags stay put:** a tag you add to a watchlist film is never wiped by a re-import, even if Letterboxd has a tag with the same name.
- **Letterboxd as a safety net:** when no other site has a film's poster, summary, genres, runtime, cast or ids, Matinee now uses what the Letterboxd page already says. The first launch re-reads your Letterboxd pages once to pick this up (about half an hour in the background).
- **Films on screen first:** what you're looking at, hovering or have opened now jumps ahead of the background crawl, and cancelled work no longer wastes time.
- **Kinder to sites:** when a site says "slow down" Matinee pauses that site completely, and after repeated blocks it leaves the site alone for 15 minutes, then an hour, then six. Lookups that keep failing wait 1 hour, 6 hours, a day, then 3 days before trying again. If a site shows a "check you're human" page, Matinee opens a window for you to click it (at most once every 10 minutes per site); the other sites carry on meanwhile.
- **If fetching keeps failing** a quiet note appears at the bottom right, and Settings → Sources shows what is wrong with a "Copy fetch log" button.

## v0.5 — 23 Oct 2026
- **Insights:** a world map of the countries you watch, hover for the count, grey where you have none, click to open the Library for that country.
- **Fetching:** covers (Wikipedia) now go before the slower page sources (IMDb pages, Metacritic reviews); Tonight fetches the films it shows.
- **Coming back from a film** keeps your filters on Diary and Person (Tonight already did).
- **Watched vs watchlist:** a quiet "Watched" / "Watchlist" badge on the film page, Library cards and rows; clearer empty states when a status filter shows nothing.
- **Posters:** hover a poster for a small card with the scores and a blurb.
- **Wording:** plainer labels on Upcoming and By feel.
- **Library → Filters → Feel:** pick one or more feelings (sad, heartwarming, slow-burn…) and see only the films that match all of them.
- **By feel:** the match badge is now a dashed pill that can't be mistaken for the Matinee score; hover it for the real match number and the reason. Coming back from a film shows the previous results straight away.
- **Scores:** Discover cards and details, and Person filmographies, show Letterboxd, Rotten Tomatoes and IMDb in that order (for films that aren't in your library only IMDb is known).
- **Tonight:** when nothing is left it says why (not out yet, nothing fits the time, you've passed on everything). "Today" is your local day, so late-night picks and streaks no longer flip at the wrong hour.
- **Tags:** Oscar tags no longer match country submissions or other academies; English dialects aren't "foreign language"; subject tags keep their capitals.
- **Safer saving:** your library is saved with a backup copy, a locked file (antivirus) is retried instead of treated as empty, a corrupt file is set aside rather than overwritten, and backups no longer include API keys.
- **Fetching:** sites that return an unreadable page are retried next time instead of waiting weeks; every request has a time limit; progress never goes backwards; the Letterboxd short-link step backs off when Letterboxd says it's busy.
- **Updates:** if an install doesn't take over, the app restarts itself after 15 seconds into the Try again state; a missing release or GitHub's rate limit is no longer called a "bad key"; a failed download resets cleanly; experimental builds rank below their own stable.
- **Stability:** a crashed window reloads itself (up to three times a minute, then says so); a crash on one screen shows "Something went wrong on this page" with a way back instead of a blank window; startup retries before giving up; Matinee ignores junk sent to the core and refuses oversized or malformed export files with a plain message.
- **Themes:** faint and muted text is easier to read in both themes (checked against contrast targets), the light amber is slightly browner, high-contrast (forced colours) mode works, and the window background matches your theme from the first frame.
- **Keyboard and screen readers:** dialogs hold focus and give it back, a "Skip to content" link, each screen sets the window title.
- **Discover:** films you log drop out straight away; "Finish the series" skips unreleased films and shorts, and shows TV spin-offs only when Include TV is on; "not a series" answers are remembered.
- **Tags:** a "Based on a short story" tag; the source kind shows after the name on the film page, for example "Dune (novel)".
- **Library:** the list no longer jumps back to the top while films load; bulk selection drops films that leave the library; film notes save on their own (blur, a pause, or leaving the page); a failed saved-view save, delete or restore says so; big counts use thousands separators.
- **Speed:** By feel rebuilds its index in about a tenth of a second after one film changes (was 0.45 s).
- **Speed:** Diary, film pages and Tonight move about a third to a half of the data they did; the Library no longer reloads at the end of a run that changed nothing; the app stops restarting a full refresh at every launch; IMDb's ratings file is fetched at most weekly (or when five or more films need it) and never just because you opened a film.
- **Motion:** screens fade up as you arrive, buttons, chips and the sidebar ease and press in, dialogs, toasts and filter panels open smoothly, and small lists (Tonight, Insights, Settings, Discover rows) settle in. Nothing moves in the Library grid or other long lists, and all of it switches off if Windows is set to reduce motion.

## v0.4.2 — 22 Oct 2026
- **Metacritic:** pages that answered with a redirect (HTTP 301) are now followed instead of being logged as a problem.
- **Updates:** if an update doesn't finish installing, there's now a Try again button, and Download the installer goes straight to that version's installer file instead of the releases page.

## v0.4.1 — 22 Oct 2026
- **Updates:** a Check for updates now button (with when it last checked) and a Follow switch between Main and Experimental builds in Settings → Updates.
- **Time left:** no longer stuck on "working it out" when one source is idle or blocked.
- **Release notes:** each release now carries these notes, and Settings → Updates shows "What's new" when an update is waiting.

## v0.4 — 22 Oct 2026
- API keys: each key source shows its status, when it was last tested, a Test again button, the last error, and a one-line note on what it adds. A rejected key says so instead of showing 0 filled.
- Settings: Open data folder button; sidebar progress ring is labelled.
- Version numbers continue from v0.3 (next build is v0.4); About shows the installed version.
- Fetch progress: overall percent, per-category bars (covers, details, reviews, ratings) and a "time left" estimate in Settings > Sources and the fetch dropdown; Discover shows a log dropdown while it works.
- **Automatic updates (installed copy):** Matinee checks for new versions every few hours and shows "Update ready" in the sidebar; Settings → Updates has a Restart to update button (it never restarts on its own). Needs a read-only GitHub key pasted once in Settings → Updates. The portable copy can't update itself and points you to the installer. The installer is now one-click, no admin needed.
- **By feel:** the reason a film matched is no longer cut off, and it now travels with you: open the film and it shows "Why it came up under…" at the top of "How it feels".
- **No menu bar:** pressing Alt no longer shows File / Edit / View / Help at the top of the window.

## Build a83beb8 — 22 Oct 2026
- **Smoother scrolling while films load:** the app no longer reloads your whole library every few seconds; only films that changed are updated, the list is about a third of its old size, and background updates wait until you stop scrolling. The core now runs in its own process so heavy work doesn't block the window.
- **Letterboxd lookups fixed in the app:** short-link lookups could not work inside Electron; they now do (needs checking on your PC: Settings → Letterboxd links count should rise).
- **Settings:** each source shows how many films it has filled in (so you can tell the TMDB and OMDb keys are working). New Debug section.
- **Film Map archived:** hidden unless switched on under Settings → Debug.
- **Removed:** keyboard shortcuts (Ctrl+K search, "/") and the Lists feature. Tags on watchlist films stay.
- **Hover tips:** one rounded, animated box everywhere, sitting just above the pointer.

## Earlier today (builds 79cc978, 4c5b842)
- **Tonight v2:** a pick with reasons, a stretch pick and a waiting-list pick; nine occasions; "more like this".
- **Matinee score rebalanced** (research-based blend of sources); Letterboxd score first everywhere.
- **Upcoming:** Australian releases over the next six months, grouped by month.
- **On-demand fetching:** films you open, hover or scroll to are fetched first.
- **Remembers your place** (scroll and filters) when you go back.
- **By feel:** clearer closeness labels; Library: Unwatched filter.
