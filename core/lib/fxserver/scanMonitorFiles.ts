//RUSTTODO: monitor folder integrity scanning is not applicable for the Rust standalone build

type ContentFileType = {
    path: string;
    size: number;
    hash: string;
}

export default async function scanMonitorFiles() {
    //RUSTTODO: returning empty scan results to keep the diagnostics report API stable
    const allFiles: ContentFileType[] = [];
    return {
        totalFiles: 0,
        totalSize: 0,
        allFiles,
    };
}
