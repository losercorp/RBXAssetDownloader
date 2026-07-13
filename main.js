const FileService = require("fs")
const Path = require("path")
const Config = require("./config")

const Cookie = Config.Cookie
const AssetIDs = Config.AssetIDs

function NormaliseString(ID) {
	return String(ID).replace(/\D+/g, "")
}

function GetFileExtension(BufferData) {
	if (BufferData.subarray(0, 8).toString() === "<roblox!") {
		return "rbxm"
	}

	if (BufferData.subarray(0, 7).toString() === "<roblox") {
		return "rbxmx"
	}

	if (BufferData.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
		return "png"
	}

	if (BufferData.slice(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF]))) {
		return "jpg"
	}

	const Start = BufferData.slice(0, 6).toString()

	if (Start === "GIF87a" || Start === "GIF89a") {
		return "gif"
	}

	if (BufferData.slice(0, 4).toString() === "RIFF" && BufferData.slice(8, 12).toString() === "WEBP") {
		return "webp"
	}

	if (BufferData.slice(0, 4).toString() === "OggS") {
		return "ogg"
	}

	if (BufferData.slice(0, 3).toString() === "ID3") {
		return "mp3"
	}

	return "bin"
}

async function RequestHandler(URL, Options = {}) {
	while (true) {
		const Response = await fetch(URL, Options)

		if (Response.status !== 429 && Response.status !== 503) {
			return Response
		}

		const RetryAfter = Number(Response.headers.get("retry-after"))

		if (RetryAfter) {
			console.log(`[~] Rate Limited, Waiting ${RetryAfter}s`)
			await new Promise((Resolve) => setTimeout(Resolve, RetryAfter * 1000))
		} else {
			console.log("[~] Rate Limited, Waiting For Retry")
			await new Promise((Resolve) => setTimeout(Resolve, 1000))
		}
	}
}

async function GetAssetInfo(AssetID) {
	const Response = await RequestHandler(
		`https://apis.roblox.com/assets/user-auth/v1/assets/${AssetID}`,
		{
			headers: {
				Cookie: `.ROBLOSECURITY=${Cookie}`
			}
		}
	)

	if (!Response.ok) {
		return null
	}

	return await Response.json()
}

async function GetUserPlaces(UserID) {
	const Places = []
	let Cursor = ""

	do {
		const Response = await RequestHandler(
			`https://games.roblox.com/v2/users/${UserID}/games?accessFilter=Public&sortOrder=Asc&limit=50&cursor=${Cursor}`
		)

		if (!Response.ok) {
			console.log(`[-] Failed To Get User Places ${UserID}: ${Response.status}`)
			break
		}

		const Data = await Response.json()

		for (const Game of Data.data) {
			Places.push(Game.id)
		}

		Cursor = Data.nextPageCursor || ""
	} while (Cursor)

	return Places
}

async function GetGroupPlaces(GroupID) {
	const Places = []
	let Cursor = ""

	do {
		const Response = await RequestHandler(
			`https://games.roblox.com/v2/groups/${GroupID}/games?accessFilter=Public&sortOrder=Asc&limit=100&cursor=${Cursor}`
		)

		if (!Response.ok) {
			console.log(`[-] Failed To Get Group Places ${GroupID}: ${Response.status}`)
			break
		}

		const Data = await Response.json()

		for (const Game of Data.data || []) {
			if (Game.rootPlace?.id) {
				Places.push(Game.rootPlace.id)
			}
		}

		Cursor = Data.nextPageCursor || ""
	} while (Cursor)

	return Places
}

async function GetCreatorPlaces(AssetInfo) {
	const Creator = AssetInfo?.creationContext?.creator

	if (!Creator) {
		return []
	}

	if (Creator.groupId) {
		return await GetGroupPlaces(Creator.groupId)
	}

	if (Creator.userId) {
		return await GetUserPlaces(Creator.userId)
	}

	return []
}

async function RequestDownloadAsset(AssetID, PlaceID) {
	const Headers = {
		"User-Agent": "Roblox/WinInet",
		"Roblox-Place-Id": NormaliseString(PlaceID)
	}

	if (Cookie) {
		Headers.Cookie = `.ROBLOSECURITY=${Cookie}`
	}

	const Response = await RequestHandler(
		`https://assetdelivery.roblox.com/v1/asset?id=${AssetID}`,
		{
			headers: Headers
		}
	)

	if (!Response.ok) {
		return null
	}

	return Buffer.from(await Response.arrayBuffer())
}

async function DownloadAsset(AssetID) {
	AssetID = NormaliseString(AssetID)

	const AssetInfo = await GetAssetInfo(AssetID)

	if (!AssetInfo) {
		console.log(`[-] Failed To Get Asset Information ${AssetID}`)
		return false
	}

	const DisplayName = AssetInfo.displayName
	const AssetName = DisplayName ? DisplayName.replace(/[<>:"/\\|?*]/g, "") : "Unknown"
	const Places = await GetCreatorPlaces(AssetInfo)

	let BufferData = null

	for (const PlaceID of Places) {
		BufferData = await RequestDownloadAsset(
			AssetID,
			PlaceID
		)

		if (BufferData) {
			break
		}
	}

	if (!BufferData) {
		console.log(`[-] Failed ${AssetID}: No Working Place Found`)
		return false
	}

	const Extension = GetFileExtension(BufferData)
	const OutputPath = Path.join(__dirname, "Output")

	if (!FileService.existsSync(OutputPath)) {
		FileService.mkdirSync(OutputPath)
	}

	const FilePath = Path.join(
		OutputPath,
		`${AssetID} - ${AssetName}.${Extension}`
	)

	FileService.writeFileSync(
		FilePath,
		BufferData
	)

	console.log(`[+] Saved File ${FilePath}`)

	return true
}

async function Main() {
	let Downloaded = 0
	let Failed = 0
	const TotalRequested = AssetIDs.length

	for (const AssetID of AssetIDs) {
		console.log(`[~] Downloading Asset ${AssetID} (${Downloaded + Failed + 1}/${TotalRequested})`)
		
		const Success = await DownloadAsset(AssetID)

		if (Success) {
			Downloaded++
		} else {
			Failed++
		}
	}

	console.log(`\n${Failed} Failed | ${Downloaded} Downloaded | ${Downloaded + Failed}/${TotalRequested} Total Requested`)
}

Main()