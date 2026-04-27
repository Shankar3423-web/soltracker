const { Connection, PublicKey } = require("@solana/web3.js");

const connection = new Connection("https://api.devnet.solana.com");
const ata = new PublicKey("E4pWSEHLentftgggf2iko3GAd95pScayCQaWmwr7zvTR");

connection.getAccountInfo(ata).then(info => {
    if (info) {
        console.log("ATA exists! size:", info.data.length);
    } else {
        console.log("ATA does NOT exist.");
    }
}).catch(console.error);
