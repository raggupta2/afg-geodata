import {Request,Response} from "express";
import { logger } from "../config/logger";
import {sanitizeCollectInput} from "../validators/collect.validator";
import {saveUserData} from "../services/collect.service";

export async function collect(req:Request,res:Response){

    try{
        const { data, ignoredFields } = sanitizeCollectInput(req.body);
        const result=await saveUserData(data);

        res.json({
            success:true,
            id:result.id.toString(),
            session_key:result.session_key,
            message:"Valid data stored successfully",
            ignoredFields
        });

    }catch(error:any){
        logger.error({ error }, "failed to collect raw user data");

        res.status(500).json({
            success:false,
            message:"Unable to store valid data at this time"
        });
    }

}
