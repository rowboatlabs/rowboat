// A curated emoji set for reactions and the composer's :name: autocomplete.
// Deliberately not a full Unicode dump (emoji-mart data is ~800KB): ~260
// entries cover what a work chat actually reaches for, and the list is one
// place to extend. Names are the Slack/GitHub shortcodes people type.

export interface EmojiEntry {
    /** The emoji itself — what goes on the wire (the contract stores the char, never a :name:). */
    e: string
    /** Primary :name:. */
    n: string
    /** Extra search words. */
    k?: string
}

/** The old fixed reaction palette — now the cold-start "frequently used" row. */
export const DEFAULT_QUICK = ['👍', '✅', '👀', '❤️', '🎉', '😂', '🚀', '🙏', '💯', '🔥', '😮', '👎']

export const EMOJI: EmojiEntry[] = [
    // Smileys
    { e: '😀', n: 'grinning', k: 'smile happy' },
    { e: '😄', n: 'smile', k: 'happy joy' },
    { e: '😁', n: 'grin', k: 'happy' },
    { e: '😆', n: 'laughing', k: 'haha lol' },
    { e: '😂', n: 'joy', k: 'lol laugh tears' },
    { e: '🤣', n: 'rofl', k: 'lol laugh' },
    { e: '🙂', n: 'slightly_smiling_face', k: 'smile' },
    { e: '😉', n: 'wink' },
    { e: '😊', n: 'blush', k: 'smile happy' },
    { e: '😇', n: 'innocent', k: 'halo angel' },
    { e: '🥰', n: 'smiling_face_with_hearts', k: 'love' },
    { e: '😍', n: 'heart_eyes', k: 'love' },
    { e: '🤩', n: 'star_struck', k: 'wow' },
    { e: '😘', n: 'kissing_heart', k: 'kiss' },
    { e: '😋', n: 'yum', k: 'tasty' },
    { e: '😜', n: 'stuck_out_tongue_winking_eye', k: 'silly' },
    { e: '🤪', n: 'zany_face', k: 'crazy' },
    { e: '🤗', n: 'hugs', k: 'hug' },
    { e: '🤭', n: 'hand_over_mouth', k: 'oops giggle' },
    { e: '🤫', n: 'shushing_face', k: 'quiet secret' },
    { e: '🤔', n: 'thinking', k: 'hmm consider' },
    { e: '🫡', n: 'saluting_face', k: 'salute yes sir' },
    { e: '🤐', n: 'zipper_mouth_face', k: 'quiet' },
    { e: '😐', n: 'neutral_face', k: 'meh' },
    { e: '😑', n: 'expressionless' },
    { e: '🙄', n: 'roll_eyes', k: 'eyeroll' },
    { e: '😬', n: 'grimacing', k: 'awkward' },
    { e: '🤥', n: 'lying_face', k: 'pinocchio' },
    { e: '😌', n: 'relieved', k: 'calm' },
    { e: '😴', n: 'sleeping', k: 'zzz tired' },
    { e: '🥱', n: 'yawning_face', k: 'tired bored' },
    { e: '😷', n: 'mask', k: 'sick' },
    { e: '🤒', n: 'face_with_thermometer', k: 'sick fever' },
    { e: '🤯', n: 'exploding_head', k: 'mind blown' },
    { e: '🥳', n: 'partying_face', k: 'party celebrate' },
    { e: '😎', n: 'sunglasses', k: 'cool' },
    { e: '🤓', n: 'nerd_face', k: 'geek glasses' },
    { e: '🧐', n: 'monocle_face', k: 'inspect' },
    { e: '😕', n: 'confused' },
    { e: '🫤', n: 'face_with_diagonal_mouth', k: 'meh skeptical' },
    { e: '😟', n: 'worried' },
    { e: '😮', n: 'open_mouth', k: 'wow surprised' },
    { e: '😲', n: 'astonished', k: 'shocked' },
    { e: '😳', n: 'flushed', k: 'embarrassed' },
    { e: '🥺', n: 'pleading_face', k: 'puppy eyes please' },
    { e: '😢', n: 'cry', k: 'sad tear' },
    { e: '😭', n: 'sob', k: 'cry sad' },
    { e: '😤', n: 'triumph', k: 'frustrated' },
    { e: '😠', n: 'angry', k: 'mad' },
    { e: '😡', n: 'rage', k: 'angry mad' },
    { e: '🤬', n: 'cursing_face', k: 'swear angry' },
    { e: '😱', n: 'scream', k: 'shocked' },
    { e: '😨', n: 'fearful', k: 'scared' },
    { e: '😰', n: 'cold_sweat', k: 'nervous' },
    { e: '🫠', n: 'melting_face', k: 'melt embarrassed' },
    { e: '🙃', n: 'upside_down_face', k: 'silly sarcasm' },
    { e: '🫥', n: 'dotted_line_face', k: 'invisible hide' },
    { e: '😵‍💫', n: 'face_with_spiral_eyes', k: 'dizzy confused' },
    { e: '🤡', n: 'clown_face', k: 'clown' },
    { e: '💀', n: 'skull', k: 'dead lol' },
    { e: '👻', n: 'ghost', k: 'boo' },
    { e: '🤖', n: 'robot', k: 'bot agent' },
    { e: '😈', n: 'smiling_imp', k: 'devil evil' },
    // Gestures & people
    { e: '👍', n: 'thumbsup', k: '+1 yes approve like' },
    { e: '👎', n: 'thumbsdown', k: '-1 no reject' },
    { e: '👌', n: 'ok_hand', k: 'okay perfect' },
    { e: '🤌', n: 'pinched_fingers', k: 'chef italian' },
    { e: '✌️', n: 'v', k: 'peace victory' },
    { e: '🤞', n: 'crossed_fingers', k: 'luck hope' },
    { e: '🤟', n: 'love_you_gesture', k: 'rock' },
    { e: '🤘', n: 'metal', k: 'rock' },
    { e: '🖖', n: 'vulcan_salute', k: 'spock' },
    { e: '👋', n: 'wave', k: 'hello hi bye' },
    { e: '🤚', n: 'raised_back_of_hand', k: 'stop' },
    { e: '✋', n: 'raised_hand', k: 'stop high five' },
    { e: '🖐️', n: 'raised_hand_with_fingers_splayed', k: 'five' },
    { e: '👏', n: 'clap', k: 'applause bravo' },
    { e: '🙌', n: 'raised_hands', k: 'hooray praise' },
    { e: '🫶', n: 'heart_hands', k: 'love' },
    { e: '🤝', n: 'handshake', k: 'deal agreement' },
    { e: '🙏', n: 'pray', k: 'thanks please namaste' },
    { e: '👉', n: 'point_right' },
    { e: '👈', n: 'point_left' },
    { e: '👆', n: 'point_up_2', k: 'above' },
    { e: '👇', n: 'point_down', k: 'below' },
    { e: '☝️', n: 'point_up', k: 'one' },
    { e: '✊', n: 'fist_raised', k: 'power' },
    { e: '👊', n: 'fist_oncoming', k: 'bro punch' },
    { e: '💪', n: 'muscle', k: 'strong flex' },
    { e: '🧠', n: 'brain', k: 'smart think' },
    { e: '👀', n: 'eyes', k: 'look watching see' },
    { e: '👁️', n: 'eye', k: 'look' },
    { e: '🗣️', n: 'speaking_head', k: 'talk say' },
    { e: '🤦', n: 'facepalm', k: 'smh' },
    { e: '🤷', n: 'shrug', k: 'dunno whatever' },
    { e: '🙇', n: 'bow', k: 'thanks sorry' },
    { e: '💁', n: 'tipping_hand_person', k: 'sassy info' },
    { e: '🙋', n: 'raising_hand', k: 'question me' },
    { e: '🧑‍💻', n: 'technologist', k: 'coder developer' },
    { e: '🕺', n: 'man_dancing', k: 'dance' },
    { e: '💃', n: 'dancer', k: 'dance' },
    { e: '🏃', n: 'runner', k: 'run fast' },
    // Hearts
    { e: '❤️', n: 'heart', k: 'love red' },
    { e: '🧡', n: 'orange_heart', k: 'love' },
    { e: '💛', n: 'yellow_heart', k: 'love' },
    { e: '💚', n: 'green_heart', k: 'love' },
    { e: '💙', n: 'blue_heart', k: 'love' },
    { e: '💜', n: 'purple_heart', k: 'love' },
    { e: '🖤', n: 'black_heart', k: 'love' },
    { e: '🤍', n: 'white_heart', k: 'love' },
    { e: '💔', n: 'broken_heart', k: 'sad love' },
    { e: '💖', n: 'sparkling_heart', k: 'love' },
    { e: '💕', n: 'two_hearts', k: 'love' },
    { e: '💗', n: 'heartpulse', k: 'love growing' },
    // Celebration & symbols
    { e: '🎉', n: 'tada', k: 'party celebrate congrats' },
    { e: '🎊', n: 'confetti_ball', k: 'party' },
    { e: '🥂', n: 'clinking_glasses', k: 'cheers toast' },
    { e: '🍾', n: 'champagne', k: 'celebrate' },
    { e: '🎂', n: 'birthday', k: 'cake' },
    { e: '🎁', n: 'gift', k: 'present' },
    { e: '🏆', n: 'trophy', k: 'win award' },
    { e: '🥇', n: 'first_place_medal', k: 'gold win' },
    { e: '🎯', n: 'dart', k: 'target bullseye' },
    { e: '⭐', n: 'star' },
    { e: '🌟', n: 'star2', k: 'glow' },
    { e: '✨', n: 'sparkles', k: 'magic shiny new' },
    { e: '⚡', n: 'zap', k: 'lightning fast' },
    { e: '🔥', n: 'fire', k: 'hot lit flame' },
    { e: '💥', n: 'boom', k: 'explosion collision' },
    { e: '💫', n: 'dizzy', k: 'star' },
    { e: '💯', n: '100', k: 'hundred perfect' },
    { e: '💢', n: 'anger', k: 'angry' },
    { e: '💦', n: 'sweat_drops', k: 'water' },
    { e: '💤', n: 'zzz', k: 'sleep' },
    { e: '🕳️', n: 'hole' },
    { e: '💡', n: 'bulb', k: 'idea light' },
    { e: '🔦', n: 'flashlight', k: 'torch' },
    { e: '🧨', n: 'firecracker', k: 'dynamite' },
    // Nature & animals
    { e: '☀️', n: 'sunny', k: 'sun' },
    { e: '🌧️', n: 'rain_cloud', k: 'rain' },
    { e: '❄️', n: 'snowflake', k: 'cold snow' },
    { e: '🌈', n: 'rainbow' },
    { e: '🌊', n: 'ocean', k: 'wave sea' },
    { e: '🌱', n: 'seedling', k: 'plant grow' },
    { e: '🌸', n: 'cherry_blossom', k: 'flower spring' },
    { e: '🌹', n: 'rose', k: 'flower' },
    { e: '🌵', n: 'cactus' },
    { e: '🍀', n: 'four_leaf_clover', k: 'luck' },
    { e: '🐶', n: 'dog', k: 'puppy' },
    { e: '🐱', n: 'cat', k: 'kitten' },
    { e: '🐭', n: 'mouse' },
    { e: '🐰', n: 'rabbit', k: 'bunny' },
    { e: '🦊', n: 'fox_face', k: 'fox' },
    { e: '🐻', n: 'bear' },
    { e: '🐼', n: 'panda_face', k: 'panda' },
    { e: '🐨', n: 'koala' },
    { e: '🦁', n: 'lion', k: 'roar' },
    { e: '🐮', n: 'cow' },
    { e: '🐷', n: 'pig' },
    { e: '🐸', n: 'frog' },
    { e: '🐵', n: 'monkey_face', k: 'monkey' },
    { e: '🙈', n: 'see_no_evil', k: 'monkey hide' },
    { e: '🙉', n: 'hear_no_evil', k: 'monkey' },
    { e: '🙊', n: 'speak_no_evil', k: 'monkey oops' },
    { e: '🐔', n: 'chicken' },
    { e: '🐧', n: 'penguin', k: 'linux' },
    { e: '🐦', n: 'bird' },
    { e: '🦄', n: 'unicorn', k: 'magic' },
    { e: '🐝', n: 'bee', k: 'honeybee' },
    { e: '🐛', n: 'bug', k: 'insect defect' },
    { e: '🦋', n: 'butterfly' },
    { e: '🐢', n: 'turtle', k: 'slow' },
    { e: '🐍', n: 'snake', k: 'python' },
    { e: '🐙', n: 'octopus', k: 'github' },
    { e: '🦀', n: 'crab', k: 'rust' },
    { e: '🐳', n: 'whale', k: 'docker' },
    { e: '🐬', n: 'dolphin' },
    { e: '🦈', n: 'shark' },
    { e: '🐐', n: 'goat', k: 'greatest' },
    { e: '🦆', n: 'duck' },
    { e: '🦉', n: 'owl', k: 'wise night' },
    // Food & drink
    { e: '☕', n: 'coffee', k: 'cafe hot drink' },
    { e: '🍵', n: 'tea', k: 'green' },
    { e: '🧋', n: 'bubble_tea', k: 'boba' },
    { e: '🍺', n: 'beer', k: 'drink' },
    { e: '🍻', n: 'beers', k: 'cheers drink' },
    { e: '🍷', n: 'wine_glass', k: 'drink' },
    { e: '🍕', n: 'pizza' },
    { e: '🍔', n: 'hamburger', k: 'burger' },
    { e: '🌮', n: 'taco' },
    { e: '🍣', n: 'sushi' },
    { e: '🍜', n: 'ramen', k: 'noodles' },
    { e: '🍩', n: 'doughnut', k: 'donut' },
    { e: '🍪', n: 'cookie' },
    { e: '🍿', n: 'popcorn', k: 'movie watching drama' },
    { e: '🍎', n: 'apple', k: 'fruit' },
    { e: '🍌', n: 'banana', k: 'fruit' },
    { e: '🍉', n: 'watermelon', k: 'fruit' },
    { e: '🥑', n: 'avocado' },
    { e: '🥕', n: 'carrot' },
    { e: '🧀', n: 'cheese', k: 'cheese_wedge' },
    { e: '🥓', n: 'bacon' },
    { e: '🥞', n: 'pancakes' },
    { e: '🎃', n: 'jack_o_lantern', k: 'halloween pumpkin' },
    // Work & objects
    { e: '🚀', n: 'rocket', k: 'ship launch deploy' },
    { e: '🛳️', n: 'passenger_ship', k: 'ship' },
    { e: '⛵', n: 'boat', k: 'sailboat rowboat' },
    { e: '🚢', n: 'ship', k: 'deploy' },
    { e: '🚗', n: 'car', k: 'drive' },
    { e: '🚨', n: 'rotating_light', k: 'alarm alert urgent siren' },
    { e: '🚦', n: 'vertical_traffic_light', k: 'traffic' },
    { e: '🚧', n: 'construction', k: 'wip barrier' },
    { e: '⏰', n: 'alarm_clock', k: 'time wake' },
    { e: '⏳', n: 'hourglass_flowing_sand', k: 'time waiting' },
    { e: '⌛', n: 'hourglass', k: 'time done' },
    { e: '🕐', n: 'clock1', k: 'time' },
    { e: '📅', n: 'date', k: 'calendar' },
    { e: '📆', n: 'calendar', k: 'schedule' },
    { e: '📌', n: 'pushpin', k: 'pin location' },
    { e: '📍', n: 'round_pushpin', k: 'pin location' },
    { e: '📎', n: 'paperclip', k: 'attach' },
    { e: '✂️', n: 'scissors', k: 'cut' },
    { e: '📝', n: 'memo', k: 'note write pencil' },
    { e: '✏️', n: 'pencil2', k: 'edit write' },
    { e: '📖', n: 'book', k: 'read open' },
    { e: '📚', n: 'books', k: 'library study' },
    { e: '🔖', n: 'bookmark', k: 'save' },
    { e: '📄', n: 'page_facing_up', k: 'document file' },
    { e: '📊', n: 'bar_chart', k: 'graph stats poll' },
    { e: '📈', n: 'chart_with_upwards_trend', k: 'growth up' },
    { e: '📉', n: 'chart_with_downwards_trend', k: 'down decline' },
    { e: '🗂️', n: 'card_index_dividers', k: 'files organize' },
    { e: '📦', n: 'package', k: 'box ship npm' },
    { e: '📬', n: 'mailbox_with_mail', k: 'mail inbox' },
    { e: '✉️', n: 'email', k: 'mail envelope' },
    { e: '📣', n: 'mega', k: 'megaphone announce' },
    { e: '📢', n: 'loudspeaker', k: 'announce' },
    { e: '🔔', n: 'bell', k: 'notification' },
    { e: '🔕', n: 'no_bell', k: 'mute silent' },
    { e: '🔒', n: 'lock', k: 'secure private' },
    { e: '🔓', n: 'unlock', k: 'open' },
    { e: '🔑', n: 'key', k: 'password' },
    { e: '🔨', n: 'hammer', k: 'build tool' },
    { e: '🛠️', n: 'hammer_and_wrench', k: 'tools build fix' },
    { e: '🔧', n: 'wrench', k: 'fix tool' },
    { e: '⚙️', n: 'gear', k: 'settings config' },
    { e: '🧲', n: 'magnet' },
    { e: '🧪', n: 'test_tube', k: 'experiment test science' },
    { e: '🔬', n: 'microscope', k: 'science inspect' },
    { e: '🔭', n: 'telescope', k: 'explore' },
    { e: '💊', n: 'pill', k: 'medicine' },
    { e: '🩹', n: 'adhesive_bandage', k: 'bandaid hotfix' },
    { e: '💰', n: 'moneybag', k: 'cash rich' },
    { e: '💸', n: 'money_with_wings', k: 'expensive spend' },
    { e: '🪙', n: 'coin', k: 'money' },
    { e: '⚖️', n: 'balance_scale', k: 'justice tradeoff' },
    { e: '🔗', n: 'link', k: 'chain url' },
    { e: '📷', n: 'camera', k: 'photo' },
    { e: '🎥', n: 'movie_camera', k: 'video film' },
    { e: '🎬', n: 'clapper', k: 'action movie' },
    { e: '🎤', n: 'microphone', k: 'mic sing drop' },
    { e: '🎧', n: 'headphones', k: 'music audio' },
    { e: '🎵', n: 'musical_note', k: 'music' },
    { e: '🎮', n: 'video_game', k: 'game controller' },
    { e: '🎲', n: 'game_die', k: 'dice random' },
    { e: '🧩', n: 'jigsaw', k: 'puzzle piece' },
    { e: '🎨', n: 'art', k: 'palette design paint' },
    { e: '🖥️', n: 'desktop_computer', k: 'computer' },
    { e: '💻', n: 'computer', k: 'laptop code' },
    { e: '⌨️', n: 'keyboard', k: 'type' },
    { e: '🖱️', n: 'computer_mouse', k: 'click' },
    { e: '💾', n: 'floppy_disk', k: 'save' },
    { e: '🖨️', n: 'printer', k: 'print' },
    { e: '📱', n: 'iphone', k: 'phone mobile' },
    { e: '☎️', n: 'phone', k: 'call telephone' },
    { e: '🔋', n: 'battery', k: 'power' },
    { e: '🪫', n: 'low_battery', k: 'drained tired' },
    { e: '🧯', n: 'fire_extinguisher', k: 'hotfix incident' },
    { e: '🗑️', n: 'wastebasket', k: 'trash delete' },
    { e: '🧹', n: 'broom', k: 'clean sweep' },
    { e: '🧼', n: 'soap', k: 'clean' },
    { e: '🛑', n: 'stop_sign', k: 'stop halt' },
    { e: '⛔', n: 'no_entry', k: 'blocked forbidden' },
    { e: '🚫', n: 'no_entry_sign', k: 'banned prohibited' },
    { e: '⚠️', n: 'warning', k: 'caution alert' },
    { e: '❗', n: 'exclamation', k: 'important bang' },
    { e: '❓', n: 'question', k: 'ask what' },
    { e: '❌', n: 'x', k: 'cross no wrong' },
    { e: '⭕', n: 'o', k: 'circle correct' },
    { e: '✅', n: 'white_check_mark', k: 'check done yes approve' },
    { e: '☑️', n: 'ballot_box_with_check', k: 'check done' },
    { e: '✔️', n: 'heavy_check_mark', k: 'check done' },
    { e: '➕', n: 'heavy_plus_sign', k: 'plus add' },
    { e: '➖', n: 'heavy_minus_sign', k: 'minus remove' },
    { e: '➡️', n: 'arrow_right', k: 'next' },
    { e: '⬅️', n: 'arrow_left', k: 'back' },
    { e: '⬆️', n: 'arrow_up', k: 'up' },
    { e: '⬇️', n: 'arrow_down', k: 'down' },
    { e: '🔄', n: 'arrows_counterclockwise', k: 'refresh sync retry' },
    { e: '🔁', n: 'repeat', k: 'loop' },
    { e: '🔀', n: 'twisted_rightwards_arrows', k: 'shuffle merge' },
    { e: '♻️', n: 'recycle', k: 'reuse green' },
    { e: '🆗', n: 'ok', k: 'okay' },
    { e: '🆕', n: 'new' },
    { e: '🆒', n: 'cool' },
    { e: '🆓', n: 'free' },
    { e: '🔟', n: 'keycap_ten', k: 'ten 10 poll' },
    { e: '1️⃣', n: 'one', k: '1 poll' },
    { e: '2️⃣', n: 'two', k: '2 poll' },
    { e: '3️⃣', n: 'three', k: '3 poll' },
    { e: '4️⃣', n: 'four', k: '4 poll' },
    { e: '5️⃣', n: 'five', k: '5 poll' },
    { e: '6️⃣', n: 'six', k: '6 poll' },
    { e: '7️⃣', n: 'seven', k: '7 poll' },
    { e: '8️⃣', n: 'eight', k: '8 poll' },
    { e: '9️⃣', n: 'nine', k: '9 poll' },
    { e: '🅰️', n: 'a', k: 'letter' },
    { e: '🅱️', n: 'b', k: 'letter' },
    { e: '🇮🇳', n: 'flag_india', k: 'india in' },
    { e: '🇺🇸', n: 'flag_us', k: 'usa america' },
    { e: '🌍', n: 'earth_africa', k: 'world globe' },
    { e: '🌎', n: 'earth_americas', k: 'world globe' },
    { e: '🗺️', n: 'world_map', k: 'map travel' },
    { e: '🏠', n: 'house', k: 'home' },
    { e: '🏢', n: 'office', k: 'building work' },
    { e: '🏖️', n: 'beach_umbrella', k: 'vacation holiday' },
    { e: '🏔️', n: 'mountain_snow', k: 'mountain' },
    { e: '🌙', n: 'crescent_moon', k: 'night' },
    { e: '🪐', n: 'ringed_planet', k: 'saturn space' },
    { e: '☄️', n: 'comet', k: 'space' },
    { e: '🎪', n: 'circus_tent', k: 'circus chaos' },
    { e: '🫧', n: 'bubbles', k: 'clean soap' },
]

// ---------------------------------------------------------------------------
// Usage — "frequently used" is per install, like drafts and read marks.
// ---------------------------------------------------------------------------

const USAGE_KEY = 'spaces:emojiUsage'

let usage: Record<string, number> | null = null

function loadUsage(): Record<string, number> {
    if (usage) return usage
    try {
        usage = JSON.parse(window.localStorage.getItem(USAGE_KEY) ?? '{}') as Record<string, number>
    } catch {
        usage = {}
    }
    return usage
}

export function noteEmojiUsed(emoji: string): void {
    const u = loadUsage()
    u[emoji] = (u[emoji] ?? 0) + 1
    try {
        window.localStorage.setItem(USAGE_KEY, JSON.stringify(u))
    } catch {
        // best-effort
    }
}

/** Most-used first, padded with the default quick palette to `limit`. */
export function frequentEmoji(limit = 12): string[] {
    const u = loadUsage()
    const used = Object.entries(u)
        .sort((a, b) => b[1] - a[1])
        .map(([e]) => e)
    const out: string[] = []
    for (const e of [...used, ...DEFAULT_QUICK]) {
        if (!out.includes(e)) out.push(e)
        if (out.length >= limit) break
    }
    return out
}

let byNameMap: Map<string, EmojiEntry> | null = null
function byName(name: string): EmojiEntry | undefined {
    if (!byNameMap) byNameMap = new Map(EMOJI.map((entry) => [entry.n, entry]))
    return byNameMap.get(name)
}

/**
 * Typed-out `:name:` shortcodes become the emoji at send time (the wire
 * carries the char, never a name). Code regions stay literal — same
 * address-vs-cite line the mention walker draws. Unknown names pass through.
 */
export function replaceShortcodes(text: string): string {
    const parts = text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    return parts
        .map((part, i) => (i % 2 === 1 ? part : part.replace(/:([a-z0-9_+-]{2,}):/g, (m, name: string) => byName(name)?.e ?? m)))
        .join('')
}

/** Substring match on name and keywords; name-prefix matches rank first. */
export function searchEmoji(query: string, limit = 24): EmojiEntry[] {
    const q = query.toLowerCase()
    if (!q) return EMOJI.slice(0, limit)
    const prefix: EmojiEntry[] = []
    const rest: EmojiEntry[] = []
    for (const entry of EMOJI) {
        if (entry.n.startsWith(q)) prefix.push(entry)
        else if (entry.n.includes(q) || entry.k?.includes(q)) rest.push(entry)
        if (prefix.length >= limit) break
    }
    return [...prefix, ...rest].slice(0, limit)
}
